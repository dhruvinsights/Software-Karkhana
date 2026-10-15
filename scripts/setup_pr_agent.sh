#!/usr/bin/env bash
# Installs the vendored PR-Agent (third_party/pr-agent, MIT) into its own
# virtualenv so its dependency set never touches the API's. Prints the Python
# path to put in PR_AGENT_PYTHON.
set -euo pipefail
cd "$(dirname "$0")/.."
VENV="${PR_AGENT_VENV:-.venv-pr-agent}"
PY="${PR_AGENT_BASE_PYTHON:-3.12}"
# uv creates the venv (and fetches Python >= 3.12 if the machine lacks it).
command -v uv >/dev/null || { echo "install uv: https://docs.astral.sh/uv/"; exit 1; }
[ -d "$VENV" ] || uv venv --python "$PY" "$VENV"
# google-auth: PR-Agent's LiteLLM handler imports it unconditionally.
uv pip install --python "$VENV/bin/python" -q ./third_party/pr-agent google-auth
echo "PR_AGENT_PYTHON=$(pwd)/$VENV/bin/python"
