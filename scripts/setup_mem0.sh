#!/usr/bin/env bash
# Installs the vendored mem0 (third_party/mem0, Apache-2.0) into its own
# virtualenv. Prints the Python path to put in MEM0_PYTHON.
set -euo pipefail
cd "$(dirname "$0")/.."
VENV="${MEM0_VENV:-.venv-mem0}"
command -v uv >/dev/null || { echo "install uv: https://docs.astral.sh/uv/"; exit 1; }
[ -d third_party/mem0 ] || git clone --depth 1 https://github.com/mem0ai/mem0.git third_party/mem0
[ -d "$VENV" ] || uv venv --python "${MEM0_BASE_PYTHON:-3.12}" "$VENV"
uv pip install --python "$VENV/bin/python" -q -e ./third_party/mem0 ollama
echo "MEM0_PYTHON=$(pwd)/$VENV/bin/python"
