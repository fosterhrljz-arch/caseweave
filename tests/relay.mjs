import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'caseweave-relay-'));
const fixture = join(directory, 'RelayFixture.exe');
const compiler = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const compile = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${fixture}`, '/r:System.Net.Http.dll', '/r:System.Web.Extensions.dll', join(root, 'relay', 'RelayHost.cs'), join(root, 'tests', 'RelayFixture.cs')], { encoding: 'utf8' });
assert.equal(compile.status, 0, compile.stdout + compile.stderr);

const upstreamCalls = [];
const server = createServer(async (request, response) => {
  if (request.method !== 'POST') { response.writeHead(405).end(); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const authorized = request.headers.authorization === 'Bearer caseweave-qa-only';
  upstreamCalls.push({ authorized, body: JSON.parse(Buffer.concat(chunks)) });
  if (!authorized) { response.writeHead(401).end(); return; }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const live = process.env.CASEWEAVE_LIVE_ENDPOINT;
const destination = live || `http://127.0.0.1:${server.address().port}/v1`;
const model = live ? 'caseweave-qa' : 'relay-fixture';
const relay = spawn(fixture, [join(root, 'dist', 'index.html'), destination, model], { windowsHide: true });
const output = createInterface({ input: relay.stdout });
let browser;
try {
  const [launch] = await Promise.race([once(output, 'line'), once(relay, 'exit').then(([code]) => { throw new Error(`Relay exited (${code}).`); })]);
  assert.match(launch, /^http:\/\/127\.0\.0\.1:4179\/launch\//);
  assert.equal((await fetch('http://127.0.0.1:4179/relay/status')).status, 403);
  browser = await chromium.launch({ channel: process.env.CASEWEAVE_TEST_BROWSER || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/relay/chat')) requests.push(request); });
  await page.goto(launch);
  assert.equal(page.url(), 'http://127.0.0.1:4179/');
  await page.getByRole('heading', { name: 'Harborline Procurement Review', exact: true }).waitFor({ timeout: 7000 });
  assert.equal((await fetch(launch, { redirect: 'manual' })).status, 403);
  const cookie = (await context.cookies()).find(item => item.name === 'CaseWeaveRelay');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  assert.equal(await page.evaluate(() => document.cookie.includes('CaseWeaveRelay')), false);
  const status = await page.evaluate(async () => (await fetch('/relay/status')).json());
  assert.deepEqual(Object.keys(status).sort(), ['destination', 'model', 'revision']);
  const hostile = await fetch('http://127.0.0.1:4179/relay/chat', { method: 'POST', headers: { Cookie: `${cookie.name}=${cookie.value}`, Origin: 'http://example.invalid', 'Content-Type': 'application/json', 'X-CaseWeave-Revision': status.revision }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Synthetic blocked request.' }] }) });
  assert.equal(hostile.status, 403);
  await page.getByRole('navigation').getByRole('button', { name: 'Settings' }).click();
  if (!live) {
    await page.getByLabel('Direct provider').selectOption('OpenAI-compatible');
    await page.getByLabel('API base URL').fill(destination);
    await page.getByLabel('Model', { exact: true }).fill(model);
    await page.getByRole('button', { name: 'Test and connect' }).click();
    await page.getByRole('alert').getByText(/browser could not reach this endpoint/).waitFor();
    assert.equal(upstreamCalls.length, 0);
  }
  await page.getByRole('button', { name: 'Test Windows relay' }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor({ timeout: 35_000 });
  assert.equal(requests.length, 1);
  assert.equal((await requests[0].allHeaders()).authorization, undefined);
  assert.ok(!requests[0].postData().includes('caseweave-qa-only'));
  if (!live) {
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].authorized, true);
    assert.equal(upstreamCalls[0].body.model, model);
  }
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '10-relay-settings.png'), animations: 'disabled' });
  const changed = once(output, 'line');
  relay.stdin.write('change\n');
  await changed;
  const stale = await page.evaluate(async revision => (await fetch('/relay/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CaseWeave-Revision': revision }, body: '{"messages":[{"role":"user","content":"Synthetic stale request."}]}' })).status, status.revision);
  assert.equal(stale, 409);
  assert.deepEqual(errors, []);
  console.log(live ? 'Windows relay: authenticated completion from real llama.cpp server.' : 'Windows relay: CORS fallback, origin checks, session, credential isolation, and stale revision passed.');
} finally {
  await browser?.close();
  relay.stdin.end('stop\n');
  server.close();
}
