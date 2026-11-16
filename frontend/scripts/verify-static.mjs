// Lightweight production-bundle smoke test for machines unable to launch Chromium.
// Executes the built React entry in a DOM with an unavailable API. No backend starts.
import { JSDOM } from 'jsdom';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const directory = resolve(process.argv[2] ?? 'dist');
const configured = process.argv[3] === 'configured';
const dom = new JSDOM(await readFile(resolve(directory, 'index.html'), 'utf8'), { url:'https://static.example.test/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLScriptElement', 'localStorage']) {
  Object.defineProperty(globalThis, name, { value:dom.window[name], configurable:true });
}
const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  throw Error('API intentionally unavailable during static verification');
};
const files = await readdir(resolve(directory, 'assets'));
const entry = files.find(file => /^app-entry-.*\.js$/.test(file));
assert.ok(entry, 'Built React entry exists');
await import(pathToFileURL(resolve(directory, 'assets', entry)).href);
async function waitFor(check) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Production UI rendered before timeout');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
await waitFor(() => document.querySelector('[role=alert]'));
assert.match(document.body.textContent, /Vault data unavailable/);
assert.equal(document.querySelectorAll('nav a').length, 2);
assert.equal(document.querySelector('h1').textContent, 'Stake Arena');
window.location.hash = '/create';
await waitFor(() => document.querySelector('h1')?.textContent === 'Create Vault');
assert.match(document.body.textContent, /CHIPNET — TEST FUNDS ONLY/);
if (configured) {
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => request.url === 'https://indexer.example.test/read-only/vaults' && request.options.credentials === 'omit'));
} else {
  assert.equal(requests.length, 0, 'Offline production build makes no API calls');
  assert.match(document.body.textContent, /Offline · no API configured/);
}
console.log(`PASS: built ${configured?'configured API outage':'offline'} UI renders and navigates without a backend`);
dom.window.close();
process.exit(0);
