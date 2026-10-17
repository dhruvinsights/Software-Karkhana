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

"""Printable documents: Jinja2 HTML templates rendered to PDF by headless Chromium.

Templates live in ``app/reports/templates``. HTML is autoescaped, so model
text can never inject markup. ``to_pdf`` prints with Chromium's own page
header and footer (title and page numbers on every page).
"""

from __future__ import annotations

import asyncio
import datetime as dt
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

_ENV = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(["html", "j2"]),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)
# One Chromium at a time: each print launches a browser (~150 MB).
_PRINT_SLOT = asyncio.Semaphore(2)

_FOOTER = """
<div style="width:100%;font:7pt -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#8a8f9c;
            padding:0 18mm;display:flex;justify-content:space-between;">
  <span>{title}</span>
  <span>Software Karkhana · page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>
"""

SCORE_ROWS = (
    ("user_value", "User value", "Higher is better"),
    ("strategic_fit", "Strategic fit", "Higher is better"),
    ("feasibility", "Technical feasibility", "Higher is better"),
    ("effort", "Effort", "Lower is better"),
    ("risk", "Risk", "Lower is better"),
)


def idea_report_html(
    *, idea: Any, product: Any, author: str | None, stored: dict[str, Any]
) -> str:
    """The evaluation report as a standalone HTML page."""
    report, meta = stored["report"], stored["meta"]
    repo = meta.get("repoUrl") or ""
    generated = dt.datetime.fromisoformat(meta["generatedAt"])
    return _ENV.get_template("idea_report.html.j2").render(
        idea=idea,
        product=product,
        author=author,
        r=report,
        meta=meta,
        repo_name=repo.removeprefix("https://github.com/").removesuffix(".git"),
        generated_on=generated.strftime("%d %b %Y"),
        total_weeks=round(sum(p["weeks"] for p in report["phases"]), 1),
        score_rows=SCORE_ROWS,
    )


async def to_pdf(html: str, *, title: str) -> bytes:
    """Prints ``html`` to an A4 PDF with a running footer."""
    from playwright.async_api import async_playwright

    footer = _FOOTER.format(title=title.replace("<", "&lt;").replace(">", "&gt;"))
    async with _PRINT_SLOT, async_playwright() as pw:
        browser = await pw.chromium.launch()
        try:
            page = await browser.new_page()
            # No network: the page is self-contained, and a template must never
            # be able to fetch anything while it is rendered.
            await page.route("**/*", lambda route: route.abort())
            await page.set_content(html, wait_until="load")
            return await page.pdf(
                format="A4",
                print_background=True,
                prefer_css_page_size=True,
                display_header_footer=True,
                header_template="<span></span>",
                footer_template=footer,
            )
        finally:
            await browser.close()


def project_plan_html(
    *,
    project: Any,
    product: Any,
    prd_doc: Any,
    erd_doc: Any | None,
    epics: list[Any],
    stories: list[Any],
    approver: str | None,
) -> str:
    """The PRD with its data model and backlog as one printable document."""
    return _ENV.get_template("project_plan.html.j2").render(
        project=project,
        product=product,
        prd_doc=prd_doc,
        prd=prd_doc.content,
        erd=erd_doc.content if erd_doc else None,
        epics=epics,
        stories=stories,
        approver=approver,
        prepared_on=prd_doc.created_at.strftime("%d %b %Y"),
        approved_on=prd_doc.approved_at.strftime("%d %b %Y") if prd_doc.approved_at else "",
    )
