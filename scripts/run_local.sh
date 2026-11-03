#!/usr/bin/env bash
# For an existing Isaac Sim install (workstation or `pip install isaacsim`).
#   ISAAC_SIM_PATH=~/isaacsim ./scripts/run_local.sh [--livestream] [--speed 2]
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO"
if [[ -n "${ISAAC_SIM_PATH:-}" ]]; then PY="$ISAAC_SIM_PATH/python.sh"; else PY="python"; fi
"$PY" -m pip install -q -r requirements.txt
[ -f assets/simready/manifest.json ] || "$PY" tools/fetch_simready.py
"$PY" isaac/build_v8_factory.py "$@"
