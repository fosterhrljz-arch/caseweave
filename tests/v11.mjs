import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = pathToFileURL(join(root, 'dist', 'index.html')).href;
const uploads = [];
let release;
let holdNext = false;
let failNext = false;
const mock = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  response.setHeader('Content-Type', 'application/json');
  const raw = [];
  for await (const part of request) raw.push(part);
  const input = JSON.parse(Buffer.concat(raw));
  let content = 'OK';
  if (input.messages.length > 1) {
    const payload = JSON.parse(input.messages[1].content);
    uploads.push(payload);
    if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
    if (failNext) { failNext = false; response.writeHead(429).end('{}'); return; }
    const part = payload.untrustedSources[0];
    const draft = payload.task === 'Draft report';
    content = JSON.stringify({ items: [{
      kind: draft ? 'draft' : 'fact', title: draft ? 'Draft installation chronology' : 'Combined batch observation',
      body: draft ? 'The committee scheduled a technical evaluation before the purchase order.' : 'The selected records include advance checks.',
      citations: [{ id: part.id, quote: draft ? part.text : part.text.slice(0, 40).trim() }],
    }] });
  }
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
mock.listen(0, '127.0.0.1');
await once(mock, 'listening');
const endpoint = `http://127.0.0.1:${mock.address().port}/v1`;
const temporary = await mkdtemp(join(tmpdir(), 'caseweave-v11-qa-'));
let browser;
try {
  browser = await chromium.launch({ channel: process.env.CASEWEAVE_TEST_BROWSER || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const btn = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
  const nav = name => btn(name, page.getByRole('navigation')).click();
  const heading = name => page.getByRole('heading', { name, exact: true });
  const dialog = () => page.getByRole('dialog');
  const shot = name => page.screenshot({ path: join(root, 'docs', 'screenshots', name + '.png'), animations: 'disabled' });
  const trash = async () => { await nav('Settings'); await btn(/^Trash \(\d+\)$/).click(); await heading('Trash').waitFor(); };
  const restore = async name => { const row = page.getByRole('row').filter({ hasText: name }); await btn('Restore', row).click(); await row.waitFor({ state: 'hidden' }); };
  const trashInDialog = async () => { await btn('Move to Trash', dialog()).click(); await heading('Move record to Trash?').waitFor(); await btn('Move to Trash', dialog()).click(); await dialog().waitFor({ state: 'hidden' }); };
  const record = name => page.locator('.evidence-list .document-row').filter({ hasText: name });

  await page.goto(app);
  await heading('Harborline Procurement Review').waitFor();
  await nav('Evidence Library');
  await record('Signed purchase order.txt').click();
  await btn('Edit evidence details').click();
  await page.getByLabel('Display title').fill('Purchase order · intake copy');
  await btn('Save changes').click();
  await heading('Purchase order · intake copy').waitFor();
  await btn('Trash evidence file').click();
  await btn('Move to Trash', dialog()).click();
  await dialog().waitFor({ state: 'hidden' });
  await nav('Event Timeline');
  await btn('Purchase order signed', page.locator('table')).click();
  assert.equal(await page.locator('.record-detail .badge').first().textContent(), 'Unverified');
  assert.equal(await btn('Source in Trash', page.locator('.record-detail')).first().isDisabled(), true);
  await trash();
  await shot('07-trash');
  await restore('Purchase order · intake copy');
  await nav('Event Timeline');
  await btn('Purchase order signed', page.locator('table')).click();
  assert.equal(await page.locator('.record-detail .badge').first().textContent(), 'Verified');
  await page.locator('.record-detail .source-link').filter({ hasText: 'Paragraph 2' }).click();
  assert.match(await page.locator('mark.active-mark').textContent(), /PO-0247/);

  await record('Procurement approval memo.txt').click();
  await btn('Edit highlight').click();
  await dialog().getByLabel('Annotation note').fill('Scope of authorization · checked');
  await btn('Save highlight', dialog()).click();
  await btn('Scope of authorization · checked').waitFor();
  await btn('Edit highlight').click(); await trashInDialog();
  await btn('Trash evidence file').click(); await btn('Move to Trash', dialog()).click(); await dialog().waitFor({ state: 'hidden' });
  await trash();
  await btn('Restore', page.getByRole('row').filter({ hasText: 'Scope of authorization · checked' })).click();
  await page.getByText('Restore the original evidence file before restoring this annotation.').waitFor();
  const downloads = page.waitForEvent('download');
  await nav('Settings'); await btn('Export backup').click();
  const archivedFile = await readFile(await (await downloads).path());
  const backup = JSON.parse(archivedFile);
  assert.equal(backup.version, 2);
  assert.equal(typeof backup.project.trash.find(item => item.kind === 'evidence').item.original, 'string');
  await trash(); await restore('Procurement approval memo.txt'); await restore('Scope of authorization · checked');

  await nav('Event Timeline');
  await btn('Purchase order signed', page.locator('table')).click();
  await btn('Edit event').click();
  await dialog().getByLabel('Description').fill('PO-0247 was signed for depot installation.');
  await btn('Save changes', dialog()).click(); await page.getByText('PO-0247 was signed for depot installation.').waitFor();
  await btn('Edit event').click(); await trashInDialog();
  await btn('Purchase order signed', page.locator('table')).waitFor({ state: 'hidden' });
  await trash(); await restore('Purchase order signed');

  await nav('Relationships');
  await page.locator('.graph-node').filter({ has: page.locator('title', { hasText: 'Harborline Transit' }) }).focus(); await page.keyboard.press('Enter');
  await btn('Edit entity').click();
  await dialog().getByLabel('Profile notes').fill('Transit authority with documented procurement roles.');
  await btn('Save changes', dialog()).click(); await page.getByText('Transit authority with documented procurement roles.').waitFor();
  await btn('Edit entity').click(); await trashInDialog();
  await heading('Unavailable connections').waitFor();
  assert.equal(await page.locator('.graph-edge').count(), 1);
  await trash(); await restore('Harborline Transit');
  await nav('Relationships');
  await page.locator('.graph-edge').filter({ has: page.locator('title', { hasText: 'Issued purchase order to' }) }).focus(); await page.keyboard.press('Enter');
  await btn('Edit relationship').click();
  await dialog().getByLabel('Relationship label').fill('Issued PO-0247 to');
  await btn('Save changes', dialog()).click(); await heading('Issued PO-0247 to').waitFor();
  await btn('Edit relationship').click(); await trashInDialog();
  await trash(); await restore('Issued PO-0247 to');

  await nav('AI Analysis'); await btn(/^Issues/).click();
  await btn('Edit issue').first().click();
  await dialog().getByLabel('Title').fill('Installation start remains disputed');
  await btn('Save changes', dialog()).click(); await heading('Installation start remains disputed').waitFor();
  await btn('Edit issue').first().click(); await trashInDialog();
  await trash(); await restore('Installation start remains disputed');

  await nav('Evidence Library'); await record('Purchase order · intake copy').click();
  await btn('Create fact from Paragraph 2').click();
  await dialog().getByLabel('Title').fill('Purchase order source fact');
  await btn('Create fact', dialog()).click(); await dialog().waitFor({ state: 'hidden' });
  await nav('AI Analysis'); await btn(/^Case records/).click();
  await btn('Edit record').click();
  await dialog().getByLabel('Title').fill('Purchase order source fact · edited');
  await btn('Save changes', dialog()).click(); await heading('Purchase order source fact · edited').waitFor();
  await btn('Edit record').click(); await trashInDialog();
  await trash(); await restore('Purchase order source fact · edited');

  await nav('Settings');
  await page.getByLabel('Direct provider').selectOption('OpenAI-compatible');
  await page.getByLabel('API base URL').fill(endpoint);
  await page.getByLabel('Model', { exact: true }).fill('caseweave-v11-mock');
  await btn('Test and connect').click(); await btn('Disconnect').waitFor();
  await nav('AI Analysis');
  await page.getByLabel('Analysis task').selectOption('Draft report');
  await page.getByLabel('Procurement approval memo.txt', { exact: true }).check();
  await btn('Preview AI request').click();
  assert.equal(uploads.length, 0);
  await btn('Allow and send', dialog()).click();
  await heading('Draft installation chronology').waitFor();
  await btn('Add to draft').first().click();
  await dialog().getByLabel('Title').fill('Harborline working draft');
  await btn('Add to draft', dialog()).click();
  await heading('Harborline working draft').waitFor();
  await btn('Edit section').click();
  await dialog().getByLabel('Section text').fill('The committee met between May 21 and May 24. The memo documents the requirement for finance approval.');
  await dialog().getByLabel('I checked the section against its sources').check();
  await btn('Save changes', dialog()).click();
  await page.getByText('Reviewed', { exact: true }).waitFor();
  await btn('Add section').click();
  await dialog().getByLabel('Section heading').fill('Follow-up');
  await dialog().getByLabel('Section text').fill('Request the scoring worksheet.');
  await btn('Save changes', dialog()).click(); await heading('Follow-up').waitFor();
  await btn('Move section up').last().click();
  await page.waitForFunction(() => document.querySelector('.queue-item h3')?.textContent === 'Follow-up');
  if (await btn('Dismiss message').isVisible()) await btn('Dismiss message').click();
  await shot('08-report-draft');
  const markdownEvent = page.waitForEvent('download');
  await btn('Export Markdown').click();
  const markdown = await readFile(await (await markdownEvent).path(), 'utf8');
  assert.ok(markdown.indexOf('## Follow-up') < markdown.indexOf('## Draft installation chronology'));
  assert.match(markdown, /AI-assisted · Reviewed/);
  assert.match(markdown, /Needs review/);
  assert.match(markdown, /#source-1/);
  assert.match(markdown, /[a-f0-9]{64}/);
  await page.pdf({ path: join(temporary, 'draft.pdf'), preferCSSPageSize: true });
  await page.locator('.queue-item .source-link').first().click();
  await heading('Cited passage').waitFor();

  await btn('Investigations', page.locator('.breadcrumb')).click(); await btn('New investigation').click();
  await dialog().getByLabel('Investigation name').fill('Batch coverage test');
  await btn('Create investigation', dialog()).click(); await heading('Batch coverage test').waitFor();
  await btn('Import evidence').click();
  const incoming = [1, 2].map(index => ({ name: `bulk_${index}.txt`, mimeType: 'text/plain', buffer: Buffer.from(Array.from({ length: 4 }, (_, part) => `Source ${index}, paragraph ${part + 1}. Rehearsal evidence. ${'a'.repeat(3390)}`).join('\n\n')) }));
  await dialog().locator('input[type=file]').setInputFiles(incoming);
  await btn('Import 2 files', dialog()).click(); await dialog().waitFor({ state: 'hidden' });
  await nav('AI Analysis');
  await page.getByLabel('Batch size').selectOption('6000');
  await btn('Select all').click();
  holdNext = true;
  await btn('Preview AI request').click();
  assert.ok(await dialog().getByLabel('Preview batch').locator('option').count() > 1);
  await btn('Allow and send', dialog()).click();
  await btn('Pause after current batch').click();
  const pauseDeadline = Date.now() + 8000;
  while (!release && Date.now() < pauseDeadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(typeof release, 'function');
  release(); release = null;
  await btn(/^Analysis runs/).click();
  await page.getByText('Partial', { exact: true }).first().waitFor();
  failNext = true;
  await btn('Resume remaining batches').click(); await btn('Allow and send', dialog()).click();
  await page.locator('.ai-composer [role=alert]').getByText('Provider rate or quota limit reached (429).', { exact: true }).waitFor();
  await btn('Resume remaining batches').click(); await btn('Allow and send', dialog()).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.run-history tbody .badge')].every(el => el.textContent === 'Complete'));
  if (await btn('Dismiss message').isVisible()) await btn('Dismiss message').click();
  await shot('09-batch-coverage');
  await btn(/^Verification queue/).click();
  assert.equal(await page.locator('.queue-item').count(), 1);
  assert.ok(await page.locator('.queue-item .source-link').count() > 1);
  assert.ok(uploads.length > 4);

  await btn('Investigations', page.locator('.breadcrumb')).click();
  await page.getByLabel('Select backup').setInputFiles({ name: 'archived.caseweave.json', mimeType: 'application/json', buffer: archivedFile });
  await heading('Harborline Procurement Review (restored)').waitFor();
  await trash();
  await restore('Procurement approval memo.txt'); await restore('Scope of authorization · checked');
  await nav('Evidence Library'); await record('Procurement approval memo.txt').click();
  await btn('Trash evidence file').click(); await btn('Move to Trash', dialog()).click(); await dialog().waitFor({ state: 'hidden' });
  await trash();
  const doomed = page.getByRole('row').filter({ hasText: 'Procurement approval memo.txt' });
  await btn('Delete permanently', doomed).click(); await btn('Delete permanently', dialog()).click(); await doomed.waitFor({ state: 'hidden' });
  await nav('Event Timeline'); await btn('Committee recommendation authorized', page.locator('table')).click();
  assert.equal(await page.locator('.record-detail .badge').first().textContent(), 'Unverified');
  assert.equal(await page.locator('.record-detail .source-link').count(), 0);

  await nav('Settings'); await page.getByLabel('Interface and analysis language').selectOption('zh');
  await heading('设置').waitFor(); await heading('数据安全').waitFor();
  await nav('报告'); await heading('调查摘要').waitFor();
  const chineseEvent = page.waitForEvent('download'); await btn('导出 Markdown').click();
  const chinese = await readFile(await (await chineseEvent).path(), 'utf8');
  assert.match(chinese, /## 调查摘要/); assert.match(chinese, /## 支持证据/);
  await shot('11-chinese-report');
  assert.deepEqual(errors, []);
  console.log(`CaseWeave 1.1 recovery, linked records, batch pause/retry, draft exports, and localized reports passed. Draft PDF: ${join(temporary, 'draft.pdf')}`);
} finally {
  release?.();
  await browser?.close();
  mock.close();
}
