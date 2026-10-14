# Copyright 2026 Software Karkhana authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""ADK entry point for the Agent Starter Pack tooling.

``make playground`` (``adk web``) and ``make eval`` (``adk eval``) load
``root_agent`` from here: the Coder bound to ``KARKHANA_WORKSPACE`` (default:
the bundled demo repository). The control plane does not import this module.
"""

from __future__ import annotations

import os
from pathlib import Path

from google.adk.apps import App

from app.agents.coder import build_coder, configure_vertex_env
from app.agents.tools import Workspace

configure_vertex_env()

_workspace = Path(
    os.environ.get("KARKHANA_WORKSPACE", Path(__file__).parent.parent / "demo-repo")
)
root_agent = build_coder(Workspace(_workspace))
app = App(root_agent=root_agent, name="app")
