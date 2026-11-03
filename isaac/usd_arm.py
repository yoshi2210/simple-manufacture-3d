"""
usd_arm.py — inverse kinematics for any serial robot arm described with UsdPhysics joints.

SimReady robot packages (Comau, FANUC, UR, ...) ship joints, limits and drives but no IK configuration
(no Lula / cuMotion descriptor). This module reads the joint chain directly from the composed USD stage at
its authored (zero) pose, builds a product-of-exponentials model, and solves position + tool-axis IK with
damped least squares. Joint targets are written to the joints' angular drives, which PhysX follows.

Pure pxr + numpy, so it runs (and is unit-tested) without Isaac Sim.
"""
import math

import numpy as np
from pxr import Gf, Usd, UsdGeom, UsdPhysics


def _rot(axis, ang):
    x, y, z = axis
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def _world(cache, prim):
    m = cache.GetLocalToWorldTransform(prim)
    return np.array(m).T  # Gf is row-vector convention -> column-vector 4x4


class UsdArm:
    def __init__(self, stage, root_path, tool_length=0.2, max_joints=6):
        self.stage = stage
        self.root = root_path
        cache = UsdGeom.XformCache(Usd.TimeCode.Default())
        joints = [p for p in Usd.PrimRange(stage.GetPrimAtPath(root_path)) if p.IsA(UsdPhysics.Joint)]
        rev = {}
        fixed_body = None
        for p in joints:
            j = UsdPhysics.Joint(p)
            b0 = j.GetBody0Rel().GetTargets()
            b1 = j.GetBody1Rel().GetTargets()
            if p.IsA(UsdPhysics.RevoluteJoint) and b0 and b1:
                rev[str(b0[0])] = (p, str(b1[0]))
            elif p.IsA(UsdPhysics.FixedJoint) and not b0 and b1:
                fixed_body = str(b1[0])
        if fixed_body is None:  # no world anchor: start from the body that is never a child
            children = {c for _, c in rev.values()}
            starts = [b for b in rev if b not in children]
            fixed_body = starts[0] if starts else None
        if fixed_body is None:
            raise ValueError(f"no revolute chain under {root_path}")
        self.chain = []
        body = fixed_body
        while body in rev and len(self.chain) < max_joints:
            jp, child = rev[body]
            self.chain.append((jp, body, child))
            body = child
        if len(self.chain) < 3:
            raise ValueError(f"chain too short under {root_path}: {len(self.chain)} joints")
        self.ee_body = body
        self.axes, self.points, self.lo, self.hi, self.attrs = [], [], [], [], []
        for jp, b0, _ in self.chain:
            rj = UsdPhysics.RevoluteJoint(jp)
            T0 = _world(cache, stage.GetPrimAtPath(b0))
            lp = np.array(list(rj.GetLocalPos0Attr().Get() or Gf.Vec3f(0, 0, 0)) + [1.0])
            lr = rj.GetLocalRot0Attr().Get() or Gf.Quatf(1, 0, 0, 0)
            R0 = T0[:3, :3] / np.linalg.norm(T0[:3, :3], axis=0)  # strip scale
            q = np.array([lr.GetReal(), *lr.GetImaginary()])
            Rl = _quat_to_mat(q)
            e = {"X": [1, 0, 0], "Y": [0, 1, 0], "Z": [0, 0, 1]}[rj.GetAxisAttr().Get() or "X"]
            ax = R0 @ Rl @ np.array(e, float)
            self.axes.append(ax / np.linalg.norm(ax))
            self.points.append((T0 @ lp)[:3])
            lo, hi = rj.GetLowerLimitAttr().Get(), rj.GetUpperLimitAttr().Get()
            self.lo.append(math.radians(lo) if lo is not None and abs(lo) < 1e6 else -math.pi)
            self.hi.append(math.radians(hi) if hi is not None and abs(hi) < 1e6 else math.pi)
            drive = UsdPhysics.DriveAPI.Apply(jp, "angular")
            self.attrs.append(drive.GetTargetPositionAttr() or drive.CreateTargetPositionAttr(0.0))
        self.axes, self.points = np.array(self.axes), np.array(self.points)
        self.lo, self.hi = np.array(self.lo), np.array(self.hi)
        ee = _world(cache, stage.GetPrimAtPath(self.ee_body))[:3, 3]
        flange = self.axes[-1].copy()
        if np.dot(flange, ee - self.points[-2]) < 0:
            flange = -flange
        self.tool0 = ee + flange * tool_length
        self.flange0 = flange
        self.q = np.zeros(len(self.chain))
        self.base = self.points[0]

    @property
    def n(self):
        return len(self.chain)

    def fk(self, q):
        p, a = self.tool0.copy(), self.flange0.copy()
        for i in range(self.n - 1, -1, -1):
            R = _rot(self.axes[i], q[i])
            p = R @ (p - self.points[i]) + self.points[i]
            a = R @ a
        return p, a

    def solve(self, target, down=(0.0, 0.0, -1.0), iters=40, w_axis=0.5, lam=0.05, restarts=4, tol=2e-3, accept=None):
        """Damped-least-squares IK: tool point -> target, tool axis -> `down`.

        Warm-starts from the last solution (keeps motion continuous). Only if that misses by more than
        `accept` (default 10*tol) are other seeds tried; among good solutions the one closest to the previous
        joint vector wins, and revolute angles are unwrapped by +-2pi toward it, so the arm never flips."""
        target = np.asarray(target, float)
        down = np.asarray(down, float)
        accept = 10 * tol if accept is None else accept
        prev = self.q.copy()
        q = self._dls(prev, target, down, iters, w_axis, lam)
        err = self._err(q, target, down)
        if err > accept:
            rng = np.random.default_rng(7)
            cands = [(err, q)]
            for k in range(restarts + 1):
                q0 = np.zeros(self.n) if k == 0 else rng.uniform(self.lo * 0.6, self.hi * 0.6)
                qk = self._dls(q0, target, down, iters * 2, w_axis, lam)
                cands.append((self._err(qk, target, down), qk))
            best_err = min(c[0] for c in cands)
            good = [c for c in cands if c[0] <= max(tol, best_err * 1.5)]
            err, q = min(good, key=lambda c: np.linalg.norm(self._unwrap(c[1], prev) - prev))
        q = self._unwrap(q, prev)
        self.q = q
        return q

    def solve_best(self, target, prev=None, down=(0.0, 0.0, -1.0), seeds=16, iters=150, tol=2e-3, w_axis=0.5, lam=0.05):
        """Global-ish IK: many seeds; among solutions that hit the target, take the one closest to `prev`
        (or, without prev, the most natural posture: joints nearest the middle of their ranges)."""
        target, down = np.asarray(target, float), np.asarray(down, float)
        rng = np.random.default_rng(11)
        mid, half = (self.lo + self.hi) / 2, (self.hi - self.lo) / 2
        cands = []
        starts = [np.zeros(self.n)] + ([prev] if prev is not None else []) + [rng.uniform(mid - half * 0.7, mid + half * 0.7) for _ in range(seeds)]
        for q0 in starts:
            q = self._dls(np.asarray(q0, float), target, down, iters, w_axis, lam)
            if prev is not None:
                q = self._unwrap(q, prev)
            cands.append((self._err(q, target, down), q))
        best_err = min(c[0] for c in cands)
        good = [c for c in cands if c[0] <= max(tol, best_err * 1.5)]
        if prev is not None:
            cost = lambda q: float(np.abs(q - prev).max())  # noqa: E731
        else:
            cost = lambda q: float(np.sum(((q - mid) / half) ** 2))  # noqa: E731
        q = min(good, key=lambda c: cost(c[1]))[1]
        self.q = q
        return q

    def _err(self, q, target, down):
        p, a = self.fk(q)
        return float(np.linalg.norm(p - target) + 0.05 * np.linalg.norm(a - down))

    def _unwrap(self, q, ref):
        q = q.copy()
        for i in range(self.n):
            for d in (-2 * math.pi, 2 * math.pi):
                c = q[i] + d
                if self.lo[i] <= c <= self.hi[i] and abs(c - ref[i]) < abs(q[i] - ref[i]):
                    q[i] = c
        return q

    def _dls(self, q, target, down, iters, w_axis, lam):
        q = q.copy()
        for _ in range(iters):
            p, a = self.fk(q)
            err = np.concatenate([target - p, w_axis * (down - a)])
            if np.linalg.norm(err[:3]) < 1e-3 and np.linalg.norm(err[3:]) < 1e-2:
                break
            J = np.zeros((6, self.n))
            h = 1e-4
            for i in range(self.n):
                dq = q.copy()
                dq[i] += h
                p2, a2 = self.fk(dq)
                J[:3, i] = (p2 - p) / h
                J[3:, i] = w_axis * (a2 - a) / h
            dq = J.T @ np.linalg.solve(J @ J.T + lam * lam * np.eye(6), err)
            q = np.clip(q + np.clip(dq, -0.3, 0.3), self.lo, self.hi)
        return q

    def command(self, q=None):
        q = self.q if q is None else q
        for attr, v in zip(self.attrs, q):
            attr.Set(float(math.degrees(v)))

    def reach(self):
        return float(np.sum(np.linalg.norm(np.diff(np.vstack([self.points, self.tool0]), axis=0), axis=1)))


def _quat_to_mat(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
