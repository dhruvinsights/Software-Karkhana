# Copyright 2026 Software Karkhana authors
# Licensed under the Apache License, Version 2.0.
"""``python -m app.knowledge_graph rebuild``: drop and re-project every graph."""

import asyncio
import sys

from app.db import sessionmaker
from app.knowledge_graph import projector


async def _main() -> None:
    async with sessionmaker()() as session:
        n = await projector.rebuild_all(session)
    print(f"Re-projected {n} project(s).")


if __name__ == "__main__":
    if sys.argv[1:] != ["rebuild"]:
        sys.exit("usage: python -m app.knowledge_graph rebuild")
    asyncio.run(_main())
