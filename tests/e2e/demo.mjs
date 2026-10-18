// Demo smoke: Launch Software Factory opens a sandbox with no login, then the
// guided tour walks all 17 steps and finishes. Run: KARKHANA_URL=... node demo.mjs
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('response', (r) => { if (r.status() >= 500) errs.push(r.status() + ' ' + r.url()); });
await p.goto((process.env.KARKHANA_URL || 'http://localhost:5173') + '/');
await p.getByText('Launch Software Factory').first().click();
await p.getByText('Welcome to the Software Karkhana demo').waitFor({ timeout: 30000 });
console.log('welcome ok');
await p.getByText('Start the tour').click();
for (let i = 1; i <= 17; i++) {
  await p.getByText(`Step ${i} of 17`).waitFor({ timeout: 8000 });
  await p.waitForTimeout(700);
  const hasRing = await p.evaluate(() => !!document.querySelector('.border-\\[\\#3b82f6\\]'));
  const title = await p.locator('h3').first().innerText().catch(() => '?');
  const bodyErr = await p.getByText(/Something went wrong|Internal error|Unexpected Application Error/).count();
  console.log(i, hasRing ? 'RING' : 'no-ring', bodyErr ? 'ERRTEXT' : '', title);
  if (i === 1 || i === 8 || i === 12) await p.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/demo_tour_${i}.png` });
  await p.getByRole('button', { name: /^(Next|Finish tour)/ }).click();
}
await p.getByText('That was the whole factory').waitFor({ timeout: 5000 });
console.log('finish ok');
console.log('ERRORS', JSON.stringify(errs));
if (errs.length) process.exitCode = 1;
await b.close();
