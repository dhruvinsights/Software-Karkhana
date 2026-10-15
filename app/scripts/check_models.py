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

"""Reports which chat and embedding models the configured providers can call.

Usage:
    python -m app.scripts.check_models
"""

from __future__ import annotations

import asyncio

from app.ai import llm
from app.ai.providers import gemini, ollama
from app.config import get_settings


async def main() -> None:
    s = get_settings()
    print(f"chat provider:      {s.llm_provider}")
    print(f"embedding provider: {s.embed_provider}")
    if "ollama" in (s.llm_provider, s.embed_provider):
        info = await ollama.health()
        print(f"ollama {s.ollama_base_url}: {'up' if info['ok'] else info['error']}")
        for name in info["models"]:
            print(f"  - {name}")
    if "gemini" in (s.llm_provider, s.embed_provider):
        print(f"gemini configured: {gemini.configured()}")
    try:
        vector = await llm.embed("hello")
        print(f"embedding OK: {len(vector)} dimensions")
    except Exception as exc:
        print(f"embedding FAIL: {exc}")


if __name__ == "__main__":
    asyncio.run(main())
