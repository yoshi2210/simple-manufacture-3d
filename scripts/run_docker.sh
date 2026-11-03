#!/usr/bin/env bash
# Clone → this one command on any Linux machine with an NVIDIA RTX GPU, driver and NVIDIA Container Toolkit.
#   ./scripts/run_docker.sh               # GUI on a local desktop (X11)
#   ./scripts/run_docker.sh --livestream  # headless cloud GPU (Brev, etc.) + WebRTC Streaming Client
# Extra args are passed to isaac/build_v8_factory.py.
set -euo pipefail
IMAGE="${ISAAC_SIM_IMAGE:-nvcr.io/nvidia/isaac-sim:5.1.0}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${ISAAC_CACHE:-$HOME/docker/isaac-sim}"
mkdir -p "$CACHE"/{cache/main,cache/computecache,logs,data,pkg,pip}

GUI_ARGS=()
if [[ " $* " != *" --livestream "* && " $* " != *" --headless "* && -n "${DISPLAY:-}" ]]; then
  xhost +local: >/dev/null 2>&1 || true
  GUI_ARGS=(-e DISPLAY="$DISPLAY" -v /tmp/.X11-unix:/tmp/.X11-unix:rw)
fi

docker run --rm -it --gpus all --network=host \
  -e ACCEPT_EULA=Y -e PRIVACY_CONSENT=Y -e HF_TOKEN="${HF_TOKEN:-}" \
  "${GUI_ARGS[@]}" \
  -v "$CACHE/cache/main:/isaac-sim/.cache:rw" \
  -v "$CACHE/cache/computecache:/isaac-sim/.nv/ComputeCache:rw" \
  -v "$CACHE/logs:/isaac-sim/.nvidia-omniverse/logs:rw" \
  -v "$CACHE/data:/isaac-sim/.local/share/ov/data:rw" \
  -v "$CACHE/pkg:/isaac-sim/.local/share/ov/pkg:rw" \
  -v "$CACHE/pip:/isaac-sim/.cache/pip:rw" \
  -v "$REPO:/workspace:rw" -w /workspace \
  --entrypoint bash "$IMAGE" -c "
    set -e
    /isaac-sim/python.sh -m pip install -q -r requirements.txt
    [ -f assets/simready/manifest.json ] || /isaac-sim/python.sh tools/fetch_simready.py
    /isaac-sim/python.sh isaac/build_v8_factory.py $*
  "
