import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { strToU8, zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = pathToFileURL(join(root, 'dist', 'index.html')).href;
const screenshots = join(root, 'docs', 'screenshots');
const temporary = join(tmpdir(), `caseweave-qa-${Date.now()}`);
await Promise.all([mkdir(screenshots, { recursive: true }), mkdir(temporary, { recursive: true })]);

const calls = [];
const mock = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const body = [];
  for await (const part of req) body.push(part);
  const payload = JSON.parse(Buffer.concat(body));
  calls.push(payload);
  res.setHeader('Content-Type', 'application/json');
  if (payload.model === 'fail') { res.writeHead(401).end('{"error":"test error"}'); return; }
  if (payload.messages.length === 1) { res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); return; }
  const source = JSON.parse(payload.messages[1].content).untrustedSources.find(s => s.text.includes('Shipment arrived'));
  const items = [
    { kind: 'event', title: 'Cited provider result', body: 'A source dates the shipment.', date: '2025-04-12', citations: [{ id: source.id, quote: 'Shipment arrived on 2025-04-12.' }] },
    { kind: 'fact', title: 'Unsupported model claim', body: 'Synthetic claim for a reliability test.', citations: [{ id: source.id, quote: 'Invented quotation with no support.' }, { id: 'S9999', quote: source.text }] },
  ];
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
});
await new Promise((resolve, reject) => { mock.once('error', reject); mock.listen(0, '127.0.0.1', resolve); });
const endpoint = `http://127.0.0.1:${mock.address().port}/v1`;

function pdf(objects) {
  let bytes = Buffer.from('%PDF-1.4\n');
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(bytes.length);
    bytes = Buffer.concat([bytes, Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]);
  }
  return Buffer.concat([bytes, Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${bytes.length}\n%%EOF\n`)]);
}

const stream = (data, options = '') => Buffer.concat([Buffer.from(`<< /Length ${Buffer.byteLength(data)} ${options} >>\nstream\n`), Buffer.from(data), Buffer.from('\nendstream')]);
const basePdf = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'];
const docx = Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Dispatch confirmation and 简体中文 evidence.</w:t></w:r></w:p><w:p><w:r><w:t>Shipment arrived on 2025-04-12.</w:t></w:r></w:p></w:body></w:document>'),
}));
const textPdf = pdf([
  basePdf[0], '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  stream('BT /F1 24 Tf 45 310 Td (Document intake receipt) Tj ET'),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
  stream('BT /F1 24 Tf 45 310 Td (Receipt reference on page two) Tj ET'),
]);

const pageErrors = [];
const consoleWarnings = [];
const unexpectedRequests = [];
let browser;
try {
  browser = await chromium.launch({ channel: process.env.CASEWEAVE_TEST_BROWSER || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(8500);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleWarnings.push(message.text().slice(0, 250)); });
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(endpoint)) unexpectedRequests.push(request.url()); });
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
  const heading = (name, scope = page) => scope.getByRole('heading', { name, exact: true });
  const nav = name => button(name, page.getByRole('navigation')).click();
  const dialog = () => page.getByRole('dialog');
  const shot = name => page.screenshot({ path: join(screenshots, `${name}.png`), animations: 'disabled' });
  async function checkFile(file, expected) {
    await page.locator('.evidence-list .document-row').filter({ hasText: file }).click();
    await page.locator('.document-paper').getByText(expected, { exact: false }).waitFor();
  }
  async function importFiles(files, count, shouldOpen = true) {
    await button('Import evidence').first().click();
    await dialog().locator('input[type=file]').setInputFiles(files);
    await button(`Import ${count} ${count === 1 ? 'file' : 'files'}`, dialog()).click();
    if (shouldOpen) await dialog().waitFor({ state: 'hidden' });
  }

  await page.goto(app);
  assert.equal(await page.title(), 'CaseWeave · Investigation Workspace');
  await heading('Harborline Procurement Review').waitFor();
  await shot('01-overview');
  await nav('Event Timeline');
  await heading('Event Timeline').waitFor();
  await shot('02-timeline');
  await page.getByLabel('Verification status').selectOption('disputed');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByLabel('Verification status').selectOption('');
  await page.getByLabel('Filter by entity').selectOption('priya');
  assert.equal(await page.locator('tbody tr').count(), 3);
  await page.getByLabel('Filter by entity').selectOption('');
  await page.getByLabel('Filter by tag').selectOption('finance');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByLabel('Filter by tag').selectOption('');
  await page.getByLabel('Date availability').selectOption('undated');
  await heading('Exception meeting reported').waitFor();
  await page.getByLabel('Date availability').selectOption('');
  await page.getByLabel('Date from').fill('2024-05-27');
  assert.equal(await page.locator('tbody tr').count(), 2);
  await page.getByLabel('Date from').fill('');
  await button('Purchase order signed', page.locator('table')).click();
  await page.locator('.source-link').filter({ hasText: 'Paragraph 2' }).click();
  await heading('Cited passage').waitFor();
  assert.match(await page.locator('mark.active-mark').textContent(), /PO-0247/);
  await shot('03-evidence');

  await nav('Relationships');
  await page.locator('.graph-edge').filter({ has: page.locator('title', { hasText: 'Issued purchase order to' }) }).focus();
  await page.keyboard.press('Enter');
  await heading('Connection details').waitFor();
  await shot('04-relationships');
  await page.getByLabel('Relationship type').selectOption('Issued purchase order to');
  assert.equal(await page.locator('.graph-edge').count(), 1);
  await page.locator('.source-link').filter({ hasText: 'Signed purchase order.txt' }).click();
  await heading('Cited passage').waitFor();

  await nav('AI Analysis');
  await shot('05-analysis');
  const first = page.locator('.queue-item').filter({ hasText: 'Survey-only entry on May 23' });
  await button('Edit suggestion', first).click();
  await dialog().getByLabel('Title').fill('Survey-only access recorded');
  await button('Save changes', dialog()).click();
  const edited = page.locator('.queue-item').filter({ hasText: 'Survey-only access recorded' });
  await button('Approve', edited).click();
  await edited.waitFor({ state: 'hidden' });
  await button('Reject', page.locator('.queue-item').filter({ hasText: 'Authorization scope' })).click();
  await page.getByLabel('Suggestion state').selectOption('rejected');
  await heading('Authorization scope').waitFor();
  await page.getByRole('button', { name: /Case records/ }).click();
  await page.getByRole('button', { name: /Survey-only access recorded/ }).click();
  assert.match(await page.locator('.record-pane .badge').first().textContent(), /Unverified/);

  await nav('Reports');
  if (await button('Dismiss message').isVisible()) await button('Dismiss message').click();
  await shot('06-reports');
  const markdownDownload = page.waitForEvent('download');
  await button('Export Markdown').click();
  const markdown = await readFile(await (await markdownDownload).path(), 'utf8');
  assert.match(markdown, /## Supporting evidence/);
  assert.match(markdown, /[a-f0-9]{64}/);
  assert.match(markdown, /#source-1/);
  assert.match(markdown, /Survey-only access recorded.*Unverified/);
  await page.evaluate(() => { window.print = () => { window.caseweavePrintInvoked = true; }; });
  await button('Save as PDF').click();
  assert.equal(await page.evaluate(() => window.caseweavePrintInvoked), true);
  await page.pdf({ path: join(temporary, 'report.pdf'), preferCSSPageSize: true });
  assert.ok((await stat(join(temporary, 'report.pdf'))).size > 5000);

  await button('Investigations', page.locator('.breadcrumb')).click();
  await button('New investigation').click();
  await dialog().getByLabel('Investigation name').fill('QA · Evidence lab');
  await dialog().getByLabel('Investigation summary').fill('Verify originals and citations.');
  await button('Create investigation', dialog()).click();
  await heading('QA · Evidence lab').waitFor();
  const files = [
    { name: 'origin.txt', mimeType: 'text/plain', buffer: Buffer.from('Timestamp evidence\n\nShipment arrived on 2025-04-12.') },
    { name: 'register.csv', mimeType: 'text/csv', buffer: Buffer.from('id,notes\nA,"arrived\nApril 12"\n') },
    { name: 'note.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx },
    { name: 'receipt.pdf', mimeType: 'application/pdf', buffer: textPdf },
  ];
  await importFiles(files, files.length);
  await heading('Evidence Library').waitFor();
  for (const [name, content] of [['origin.txt', 'Timestamp evidence'], ['register.csv', 'April 12'], ['note.docx', '简体中文 evidence'], ['receipt.pdf', 'Document intake receipt']]) await checkFile(name, content);
  await button('Original page').click();
  await page.locator('canvas[aria-label="Original PDF page 1"]').waitFor({ state: 'visible' });
  await button('Next page').click();
  await page.locator('canvas[aria-label="Original PDF page 2"]').waitFor({ state: 'visible' });
  await button('Original text').click();
  await button('Create fact from Page 2').click();
  await dialog().getByLabel('Title').fill('Page two receipt reference');
  await button('Create fact', dialog()).click(); await dialog().waitFor({ state: 'hidden' });
  await nav('AI Analysis'); await page.getByRole('button', { name: /Case records/ }).click();
  await page.locator('.record-pane .source-link').filter({ hasText: 'Page 2' }).click();
  assert.equal(await page.locator('mark.active-mark').textContent(), 'Receipt reference on page two');
  await button('Check file integrity').click();
  await page.getByText('Original matches the recorded SHA-256.').waitFor();
  const original = page.waitForEvent('download');
  await button('Download original').click();
  assert.deepEqual(await readFile(await (await original).path()), textPdf);

  await checkFile('origin.txt', 'Shipment arrived');
  await page.locator('.passage-text').filter({ hasText: 'Shipment arrived' }).evaluate(element => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(element.firstChild, 0);
    range.setEnd(element.firstChild, 'Shipment arrived'.length);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await button('Highlight').click();
  await dialog().getByLabel('Annotation note').fill('Shipment language');
  await button('Save highlight', dialog()).click();
  await page.locator('.passage-text mark').filter({ hasText: 'Shipment arrived' }).waitFor();

  const scanJpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 1200, 800);
    context.fillStyle = '#000'; context.font = '72px Arial'; context.fillText('ARCHIVE RECEIPT', 85, 200);
    context.font = '48px Arial'; context.fillText('The shipment arrived on April 12.', 85, 335);
    return canvas.toDataURL('image/jpeg', .95).split(',')[1];
  });
  const scan = pdf([...basePdf, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>', stream(Buffer.from(scanJpeg, 'base64'), '/Type /XObject /Subtype /Image /Width 1200 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'), stream('q 600 0 0 400 0 0 cm /Im Do Q')]);
  await importFiles([{ name: 'scan.pdf', mimeType: 'application/pdf', buffer: scan }], 1);
  await page.getByText('No searchable text', { exact: true }).waitFor();
  await button('OCR page 1').click();
  await page.locator('.passage-text').filter({ hasText: 'ARCHIVE RECEIPT' }).waitFor({ timeout: 35_000 }).catch(async error => {
    console.error('OCR state:', (await page.locator('.viewer, .toast').allTextContents()).join('\n'));
    throw error;
  });

  await importFiles([{ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('test') }], 1, false);
  await dialog().getByText('Choose a PDF, DOCX, TXT, or CSV file.').waitFor();
  await button('Done', dialog()).click();
  await importFiles([
    { name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('An invalid PDF fixture.') },
    { name: 'invalid.docx', mimeType: 'application/zip', buffer: Buffer.from('An invalid DOCX fixture.') },
    { name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('name,value\n"Unclosed field,3') },
  ], 3, false);
  await dialog().getByText('This PDF could not be read. Check that it opens in a PDF viewer.').waitFor();
  await dialog().getByText('This DOCX could not be read. Check that Word can open it.').waitFor();
  await dialog().getByText('CSV contains an unclosed quoted field.').waitFor();
  await button('Done', dialog()).click();

  await nav('Event Timeline');
  await button('Add event').click();
  await dialog().getByLabel('Title').fill('Shipment received');
  await dialog().getByLabel('Date', { exact: true }).fill('2025-04-12');
  await dialog().getByLabel('Verification', { exact: true }).selectOption('verified');
  await dialog().getByLabel('Evidence document').selectOption({ label: 'note.docx' });
  await dialog().getByLabel('Evidence passage').selectOption({ index: 2 });
  await button('Attach', dialog()).click();
  await button('Create event', dialog()).click();
  await heading('Shipment received').waitFor();
  await page.locator('.source-link').filter({ hasText: 'note.docx · Paragraph 2' }).click();
  assert.match(await page.locator('mark.active-mark').textContent(), /Shipment arrived/);
  await page.reload();
  await heading('note.docx').waitFor();
  assert.match(await page.locator('mark.active-mark').textContent(), /Shipment arrived/);

  await nav('Settings');
  await page.getByLabel('Direct provider', { exact: true }).selectOption('OpenAI-compatible');
  await page.getByLabel('API base URL').fill(endpoint);
  await page.getByLabel('Model', { exact: true }).fill('fail');
  await button('Test and connect').click();
  await page.getByText('Provider rejected the API credential (401).').waitFor();
  await page.getByLabel('Model', { exact: true }).fill('local-mock');
  await page.getByLabel('API key', { exact: false }).fill('fictional-test-key');
  await button('Test and connect').click();
  await button('Disconnect').waitFor();
  await nav('AI Analysis');
  await page.getByLabel('note.docx', { exact: true }).check();
  await button('Preview AI request').click();
  await dialog().getByText('Inspect the exact evidence text').click();
  await dialog().getByText('Shipment arrived on 2025-04-12.', { exact: true }).waitFor();
  assert.equal(calls.length, 2);
  await button('Cancel', dialog()).click();
  assert.equal(calls.length, 2);
  await button('Preview AI request').click();
  await button('Allow and send', dialog()).click();
  await heading('Cited provider result').waitFor();
  assert.equal(calls.length, 3);
  const unsupported = page.locator('.queue-item').filter({ hasText: 'Unsupported model claim' });
  assert.equal(await button('Approve', unsupported).isDisabled(), true);
  await page.locator('.queue-item').filter({ hasText: 'Cited provider result' }).locator('.source-link').click();
  assert.equal(await page.locator('mark.active-mark').textContent(), 'Shipment arrived on 2025-04-12.');

  await nav('AI Analysis');
  await page.getByLabel('Analysis task').selectOption('Draft report');
  await page.getByLabel('note.docx', { exact: true }).check();
  await button('Preview AI request').click();
  await dialog().getByText('Inspect the verified case records').click();
  await dialog().getByText('Shipment received · 2025-04-12', { exact: true }).waitFor();
  await button('Allow and send', dialog()).click();
  await page.locator('.queue-item .badge').filter({ hasText: /^draft$/ }).first().waitFor();
  assert.equal(calls.length, 4);
  assert.equal(JSON.parse(calls[3].messages[1].content).verifiedCaseRecords[0].title, 'Shipment received');

  await nav('Settings');
  await button('Disconnect').click();
  await page.getByText('Disconnected', { exact: true }).waitFor();
  const backup = page.waitForEvent('download');
  await button('Export backup').click();
  const backupFile = await (await backup).path();
  const backupBytes = await readFile(backupFile);
  assert.equal(backupBytes.includes('fictional-test-key'), false);
  await button('Investigations', page.locator('.breadcrumb')).click();
  await page.getByLabel('Select backup').setInputFiles({ name: 'backup.caseweave.json', mimeType: 'application/json', buffer: backupBytes });
  await heading('QA · Evidence lab (restored)').waitFor();
  await nav('Evidence Library');
  assert.equal(await page.locator('.evidence-list .document-row').count(), 5);
  await nav('Event Timeline');
  await heading('Shipment received').waitFor();
  const legacy = JSON.parse(backupBytes);
  legacy.version = 1;
  legacy.project.name = 'Legacy 1.0 clipboard';
  for (const field of ['trash', 'drafts', 'runs']) delete legacy.project[field];
  await button('Investigations', page.locator('.breadcrumb')).click();
  await page.getByLabel('Select backup').setInputFiles({ name: 'legacy-v1.caseweave.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await heading('Legacy 1.0 clipboard (restored)').waitFor();
  await nav('Event Timeline');
  await heading('Shipment received').waitFor();
  await nav('Settings');
  await page.getByLabel('Interface and analysis language').selectOption('zh');
  await heading('设置').waitFor();
  await page.reload();
  await heading('设置').waitFor();
  const chineseJpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 1200, 800);
    context.fillStyle = '#000'; context.font = '76px "Microsoft YaHei", "SimHei", sans-serif';
    context.fillText('调查记录', 90, 200); context.fillText('证据已经收到', 90, 335);
    return canvas.toDataURL('image/jpeg', .95).split(',')[1];
  });
  const chineseScan = pdf([...basePdf, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>', stream(Buffer.from(chineseJpeg, 'base64'), '/Type /XObject /Subtype /Image /Width 1200 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'), stream('q 600 0 0 400 0 0 cm /Im Do Q')]);
  await nav('证据库');
  await button('导入证据').click();
  await dialog().locator('input[type=file]').setInputFiles([{ name: '中文扫描.pdf', mimeType: 'application/pdf', buffer: chineseScan }]);
  await button('导入 1 个文件', dialog()).click();
  await dialog().waitFor({ state: 'hidden' });
  await button('识别第 1 页').click();
  await page.getByText('第 1 页 · OCR 转录', { exact: true }).waitFor({ timeout: 30_000 });
  const chineseText = (await page.locator('.passage-text').allTextContents()).join('').replace(/\s/g, '');
  assert.match(chineseText, /调查记录|证据已经收到/);
  await nav('设置');
  await page.getByLabel('界面与分析语言').selectOption('en');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(app);
  await mobilePage.getByRole('heading', { name: 'Harborline Procurement Review' }).waitFor();
  assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await mobilePage.getByRole('button', { name: 'Toggle navigation' }).click();
  await mobilePage.getByRole('navigation').getByRole('button', { name: 'Evidence Library' }).click();
  await mobilePage.getByRole('heading', { name: 'Evidence Library', exact: true }).waitFor();
  await mobile.close();

  const profile = join(temporary, 'persisted-profile');
  const restartOptions = { channel: process.env.CASEWEAVE_TEST_BROWSER || 'chrome', viewport: { width: 1280, height: 900 } };
  let persistent = await chromium.launchPersistentContext(profile, restartOptions);
  try {
    let restartPage = persistent.pages()[0];
    restartPage.setDefaultTimeout(9000);
    await restartPage.goto(app);
    await restartPage.getByRole('heading', { name: 'Harborline Procurement Review', exact: true }).waitFor();
    await restartPage.locator('.breadcrumb').getByRole('button', { name: 'Investigations' }).click();
    await restartPage.getByRole('button', { name: 'New investigation' }).click();
    await restartPage.getByLabel('Investigation name').fill('Original restart name');
    await restartPage.getByRole('button', { name: 'Create investigation' }).click();
    await restartPage.getByRole('heading', { name: 'Original restart name', exact: true }).waitFor();
    await restartPage.locator('.breadcrumb').getByRole('button', { name: 'Investigations' }).click();
    await restartPage.getByRole('button', { name: 'Rename Original restart name' }).click();
    await restartPage.getByLabel('Investigation name').fill('Persisted case after restart');
    await restartPage.getByRole('button', { name: 'Save changes' }).click();
    await restartPage.getByRole('button', { name: 'Rename Persisted case after restart' }).waitFor();
    await persistent.close();
    persistent = await chromium.launchPersistentContext(profile, restartOptions);
    restartPage = persistent.pages()[0];
    restartPage.setDefaultTimeout(9000);
    await restartPage.goto(app);
    await restartPage.getByRole('heading', { name: 'Persisted case after restart', exact: true }).waitFor();
    await restartPage.locator('.breadcrumb').getByRole('button', { name: 'Investigations' }).click();
    await restartPage.getByRole('button', { name: 'Delete Persisted case after restart' }).click();
    await restartPage.getByRole('dialog').getByRole('button', { name: 'Delete investigation' }).click();
    await restartPage.getByRole('button', { name: 'Rename Persisted case after restart' }).waitFor({ state: 'hidden' });
  } finally { await persistent.close(); }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log(`Passed CaseWeave browser workflow. Screenshots: ${screenshots}\nPDF for text verification: ${join(temporary, 'report.pdf')}`);
} catch (error) {
  console.error('Browser errors:', pageErrors, consoleWarnings);
  throw error;
} finally {
  await browser?.close();
  mock.close();
}
