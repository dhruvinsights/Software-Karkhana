"""Reviews one real GitHub PR with Karkhana's reviewer, from the command line.

    uv run python scripts/review_pr.py owner/repo 12                 # dry run, prints
    uv run python scripts/review_pr.py owner/repo 12 --post          # posts inline review
    uv run python scripts/review_pr.py owner/repo 12 --post \
        --reviewers alice,bob                                        # also requests them

The token comes from GITHUB_TOKEN, or from `gh auth token` when that is unset.
The model comes from the usual settings (LLM_PROVIDER, REVIEW_ENGINE, ...).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys

from app.integrations.github import GitHub
from app.review import engine
from app.review.diff import anchor_comments


def _token() -> str:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        return token
    try:
        return subprocess.check_output(["gh", "auth", "token"], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        sys.exit("No GITHUB_TOKEN and `gh auth token` failed. Run `gh auth login`.")


async def main() -> int:
    """Fetches the PR, reviews it, optionally posts."""
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("repo", help="owner/name")
    ap.add_argument("number", type=int)
    ap.add_argument("--post", action="store_true", help="post the review on GitHub")
    ap.add_argument("--reviewers", default="", help="comma-separated GitHub logins")
    args = ap.parse_args()

    gh = GitHub(_token(), args.repo)
    try:
        pr = await gh.get_pull_request(number=args.number)
        diff = await gh.get_pull_request_diff(number=args.number)
        print(f"PR #{args.number}: {pr['title']}  ({len(diff)} chars of diff)")
        result = await engine.review_diff(diff, title=pr["title"])
        comments = anchor_comments(diff, list(result.comments))
        print(f"engine={result.engine} model={result.model} comments={len(comments)}")
        for c in comments:
            print(f"  [{c.severity:6}] {c.path}:{c.line or '-'}  {c.body}")
        if not args.post:
            print("\nDry run. Add --post to publish this review.")
            return 0
        review_id = await gh.post_inline_review(
            number=args.number,
            head_sha=pr["head"]["sha"],
            comments=[c.model_dump() for c in comments],
            engine=result.engine,
            summary=result.summary,
            diff=diff,
        )
        print(f"\nPosted review {review_id}: {pr['html_url']}")
        if args.reviewers:
            await gh.request_reviewers(
                number=args.number, reviewers=args.reviewers.split(",")
            )
            print(f"Requested reviewers: {args.reviewers}")
        return 0
    finally:
        await gh.aclose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
