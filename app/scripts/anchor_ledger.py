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

"""Operator tool: anchor every ledger chain head, or verify chains against anchors.

Usage:
    python -m app.scripts.anchor_ledger            # anchor every chain head now
    python -m app.scripts.anchor_ledger --verify   # verify every chain + its anchors

Suitable for a Cloud Scheduler-triggered Cloud Run Job. This is the only place
the pre-014 ``legacy`` chain (which mixes tenants) is verified.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app import db, ledger
from app.models import LedgerEntry


async def run(verify: bool) -> int:
    bad = 0
    async with db.sessionmaker()() as session:
        chains = (await session.scalars(select(LedgerEntry.chain).distinct())).all()
        for chain in sorted(chains):
            if verify:
                r = await ledger.verify_chain(
                    session, chain, anchors=ledger.load_anchors(chain)
                )
                bad += not r.ok
                print(
                    f"{chain}: ok={r.ok} entries={r.entries} anchors={r.anchors_checked}"
                    + (
                        f" first_bad_seq={r.first_bad_seq} reason={r.reason}"
                        if not r.ok
                        else ""
                    )
                )
            else:
                res = await ledger.anchor_head(session, chain, reason="scheduled")
                if res is not None:
                    bad += not res.ok
                    print(f"{chain}: ok={res.ok} {res.location or res.error}")
    await db.dispose()
    return 1 if bad else 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    sys.exit(asyncio.run(run(parser.parse_args().verify)))


if __name__ == "__main__":
    main()
