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

"""Phase 0: confirms which Gemini models this project can call.

Gemini 2.5 models retire on 2026-10-16, mid-hackathon. Run this once the
project exists and put the first working id in GEMINI_MODEL.

Usage:
    GOOGLE_CLOUD_PROJECT=my-proj python -m app.scripts.check_models
"""

from __future__ import annotations

import os

from google import genai
from google.genai import types

CANDIDATES = [
    ("global", "gemini-3-flash-preview"),
    ("global", "gemini-3.5-flash"),
    ("global", "gemini-3-flash"),
    ("global", "gemini-3.1-pro-preview"),
    ("us-central1", "gemini-2.5-flash"),
]
EMBEDDING = ("us-central1", "gemini-embedding-001")


def main() -> None:
    project = os.environ["GOOGLE_CLOUD_PROJECT"]
    for location, model in CANDIDATES:
        client = genai.Client(vertexai=True, project=project, location=location)
        try:
            r = client.models.generate_content(
                model=model,
                contents="Reply with the single word OK.",
                config=types.GenerateContentConfig(max_output_tokens=16),
            )
            print(f"OK    {location:12} {model:28} -> {(r.text or '').strip()[:20]}")
        except Exception as exc:
            print(f"FAIL  {location:12} {model:28} {str(exc)[:90]}")
    loc, model = EMBEDDING
    try:
        r = genai.Client(
            vertexai=True, project=project, location=loc
        ).models.embed_content(
            model=model,
            contents="hello",
            config=types.EmbedContentConfig(output_dimensionality=768),
        )
        print(f"OK    {loc:12} {model:28} dim={len(r.embeddings[0].values)}")
    except Exception as exc:
        print(f"FAIL  {loc:12} {model:28} {str(exc)[:90]}")


if __name__ == "__main__":
    main()
