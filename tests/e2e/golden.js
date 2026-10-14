// Drives the Karkhana golden path through the real React UI, one browser
// context per role, and records screenshots, console errors and findings.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.KARKHANA_URL || 'http://localhost:8080';
const OUT = __dirname + '/shots';
fs.mkdirSync(OUT, { recursive: true });
const ideas = JSON.parse(fs.readFileSync(__dirname + '/../../app/ai/fallbacks/demo_ideas.json', 'utf8'));
const log = [];
const issues = [];
const step = (m) => { log.push(m); console.log('STEP', m); };
const issue = (m) => { issues.push(m); console.log('ISSUE', m); };

async function asRole(browser, label, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|status of 403/.test(m.text())) issue(`[${label}] console error: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => issue(`[${label}] page error: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => { if (r.status() >= 500) issue(`[${label}] HTTP ${r.status()} ${r.url()}`); });
  await page.goto(BASE + '/projects');
  await page.getByRole('button', { name: new RegExp(`Sign in as ${label}`) }).click();
  await page.waitForSelector('.rail');
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const t0 = Date.now();
  try {
    // 1. PM submits the idea.
    const pm = await asRole(browser, 'Project manager');
    await shot(pm, '01-pm-home');
    await pm.getByPlaceholder('Invoice discount codes').fill(ideas[0].name);
    await pm.locator('textarea').fill(ideas[0].idea_text);
    await pm.getByRole('button', { name: 'Submit for evaluation' }).click();
    await pm.waitForURL(/\/projects\/[0-9a-f-]+$/);
    const projectUrl = pm.url();
    await pm.getByText('/ 10 potential').waitFor({ timeout: 60000 });
    step(`PM submitted idea; evaluation rendered (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    const quotes = await pm.locator('.quote').count();
    step(`Epics with verified source quotes on screen: ${quotes}`);
    if (quotes < 3 || quotes > 5) issue(`Expected 3-5 epics, saw ${quotes}`);
    if (await pm.getByText('Cached').count()) step('Evaluation labelled "Cached" (offline fallback), as designed');
    await shot(pm, '02-pm-evaluation');

    // 2. Developer cannot approve, even by calling the API directly.
    const dev = await asRole(browser, 'Developer');
    await dev.goto(projectUrl);
    await dev.getByText('/ 10 potential').waitFor();
    if (await dev.getByRole('button', { name: 'Approve' }).count()) issue('Approve button visible to Developer');
    const status = await dev.evaluate(async (url) => {
      const id = url.split('/').pop();
      const r = await fetch(`/api/projects/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dev-User': localStorage.getItem('karkhana-dev-user') }, body: '{"decision":"approved"}' });
      return r.status;
    }, projectUrl);
    step(`Developer calling /approve directly -> HTTP ${status}`);
    if (status !== 403) issue(`Expected 403 for developer approve, got ${status}`);

    // 3. Director approves.
    const dir = await asRole(browser, 'Director');
    await shot(dir, '03-director-home');
    await dir.goto(projectUrl);
    await dir.getByRole('button', { name: 'Approve' }).waitFor();
    await dir.locator('textarea').fill('Narrow first release; stacking rules can come later.');
    await dir.getByRole('button', { name: 'Approve' }).click();
    await dir.getByText(/Director approved the evaluate gate/).waitFor({ timeout: 15000 });
    step('Director approved; approval shown with Human-approved badge');
    await dir.locator('.board').waitFor();
    await shot(dir, '04-board-after-approval');

    // 4. Developer: assign to agent, watch the run, triage, merge.
    await dev.reload();
    await dev.locator('.board .tcard').first().waitFor();
    const readyCount = await dev.locator('.board .col').nth(1).locator('.tcard').count();
    step(`Board: ${readyCount} stories in Ready`);
    await dev.locator('.board .col').nth(1).locator('.tcard').first().click();
    await dev.getByRole('button', { name: 'Assign to agent' }).click();
    const tRun = Date.now();
    await dev.getByText(/tests exit 0/).waitFor({ timeout: 180000 });
    step(`Agent run finished, real pytest exit 0 shown (${((Date.now() - tRun) / 1000).toFixed(1)}s)`);
    await dev.getByText(/Pull request #/).waitFor({ timeout: 20000 });
    await shot(dev, '05-dev-run-and-pr');
    const mergeBtn = dev.getByRole('button', { name: 'Merge pull request' });
    if (!(await mergeBtn.isDisabled())) issue('Merge enabled before triage');
    else step('Merge disabled before triage');
    const n = await dev.locator('.drawer .cmt').count();
    step(`AI review comments: ${n}`);
    for (let i = 0; i < n - 1; i++) {
      await dev.locator('.drawer .cmt').nth(i).getByRole('button', { name: 'Valid' }).click();
      await dev.locator('.drawer .cmt').nth(i).getByText('Triaged: valid').waitFor();
    }
    const last = dev.locator('.drawer .cmt').nth(n - 1);
    await last.getByRole('button', { name: 'Dismiss' }).click();
    await last.getByPlaceholder('Why is it not valid?').fill('Codes are case-sensitive by product decision');
    await last.getByRole('button', { name: 'Dismiss' }).click();
    await last.getByText('Triaged: dismissed').waitFor();
    await dev.waitForTimeout(3500); // PR poll interval
    if (await mergeBtn.isDisabled()) issue('Merge still disabled after full triage');
    await mergeBtn.click();
    await dev.getByText(/A learning was captured as unverified/).waitFor({ timeout: 20000 });
    step('Triage complete -> merged -> learning captured (unverified)');
    await shot(dev, '06-dev-merged');

    // 5. Lead verifies the learning.
    const lead = await asRole(browser, 'Tech lead');
    await lead.goto(BASE + '/learnings');
    await lead.getByRole('button', { name: 'Verify', exact: true }).first().click();
    await lead.getByText('verified', { exact: true }).first().waitFor();
    step('Lead verified the learning');
    await shot(lead, '07-lead-learnings');

    // 6. PM project #2: memory reuse.
    await pm.goto(BASE + '/projects');
    await pm.getByPlaceholder('Invoice discount codes').fill(ideas[1].name);
    await pm.locator('textarea').fill(ideas[1].idea_text);
    await pm.getByRole('button', { name: 'Submit for evaluation' }).click();
    await pm.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await pm.getByText('/ 10 potential').waitFor({ timeout: 60000 });
    const memText = await pm.locator('.card', { hasText: 'Project memory' }).innerText();
    step(`Project #2 memory panel: "${memText.replace(/\s+/g, ' ').slice(0, 140)}"`);
    if (/No relevant memory/i.test(memText)) issue('B3 offline: project #2 shows "no relevant memory" because embeddings need Vertex AI (no GCP project here)');
    await shot(pm, '08-pm-project2-memory');

    // 7. Portfolio + ledger verify.
    await dir.goto(BASE + '/portfolio');
    await dir.getByText('Not production-ready').first().waitFor();
    await shot(dir, '09-portfolio');
    await dir.getByRole('button', { name: 'Verify chain' }).click();
    await dir.getByText(/Chain verified|BROKEN/).waitFor();
    const chain = await dir.getByText(/Chain verified|BROKEN/).innerText();
    step(`Ledger: ${chain}`);
    if (/BROKEN/.test(chain)) issue('Ledger chain broken');
    await shot(dir, '10-ledger-verified');

    // 8. Phone width.
    const mob = await asRole(browser, 'Project manager', { width: 390, height: 844 });
    await mob.goto(projectUrl);
    await mob.getByText('/ 10 potential').waitFor();
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    step(`Phone width: horizontal overflow ${overflow}px`);
    if (overflow > 2) issue(`Horizontal scroll on phone width (${overflow}px)`);
    await shot(mob, '11-mobile');
  } catch (e) {
    issue('FAILED: ' + e.message.split('\n')[0]);
  } finally {
    await browser.close();
    fs.writeFileSync(__dirname + '/report.json', JSON.stringify({ log, issues, seconds: (Date.now() - t0) / 1000 }, null, 2));
    console.log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${issues.length} issue(s)`);
  }
})();
