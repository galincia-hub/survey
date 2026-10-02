import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startMock } from '../../tools/mock-collector.mjs';
import { normalizeResponse, dedupeLatest } from '../../lib/normalize.mjs';
import { computeStats } from '../../lib/stats.mjs';
import { buildCopyText } from '../../lib/copytext.mjs';
import { buildAiPrompt } from '../../lib/prompt.mjs';
import { linkedPrefix, fmt1 } from '../../lib/format.mjs';
import { connect, getJSON, delay } from '../helpers/cdp.mjs';

const root = new URL('../../', import.meta.url).pathname;
const MOCK = 18796, STATIC = 18797, CDP = 18798;
const REPORT = 'rpt-secret-7f3a91c2e5', ADMIN = 'adm-secret-b81d40aa17';
const SURVEY_PATH = '/tests/fixtures/surveys/adora-ship-visit-001.json';
const survey = JSON.parse(fs.readFileSync(path.join(root, SURVEY_PATH), 'utf8'));
const qs = survey.sections.flatMap((s) => s.questions);

// ---- fixture payloads (legacy format, as live) ----
function answersFor(seed, tweak = {}) {
  const a = {};
  qs.forEach((q, i) => {
    if (q.type === 'score') a[q.id] = (seed * 3 + i * 2) % 21;
    else if (q.type === 'text') a[q.id] = `의견 ${seed}-${q.id}`;
    else a[q.id] = '';
  });
  return { ...a, ...tweak };
}
const firstScore = qs.find((q) => q.type === 'score').id;
const linkedText = qs.find((q) => q.type === 'text' && q.linkedScores?.length);
const payloads = [
  { ref: 'G1-01', affiliation: survey.respondent.options[0], answers: answersFor(1), submittedAt: '2026-10-02T01:00:00.000Z' },
  { ref: 'G1-01', affiliation: survey.respondent.options[0], answers: answersFor(2, { [firstScore]: 'NA', [linkedText.id]: '<b>수정본</b> & "인용"' }), submittedAt: '2026-10-02T02:00:00.000Z' },
  { ref: 'G1-02', affiliation: survey.respondent.options[1], answers: answersFor(3, { [linkedText.linkedScores[0]]: 'NA' }), submittedAt: '2026-10-02T03:00:00.000Z' },
  { ref: 'G2-05', affiliation: survey.respondent.options[3], answers: answersFor(4, { [firstScore]: '' }), submittedAt: '2026-10-02T04:00:00.000Z' },
  { ref: '', affiliation: survey.respondent.options[2], answers: answersFor(5), submittedAt: '2026-10-02T05:00:00.000Z' },
  { ref: '', affiliation: survey.respondent.options[2], answers: answersFor(6), submittedAt: '2026-10-02T06:00:00.000Z' },
].map((p) => JSON.stringify({ version: survey.version, ref: p.ref, affiliation: p.affiliation, surveyType: 'C', answers: p.answers, submittedAt: p.submittedAt }));

const all = payloads.map((p) => normalizeResponse(p));
const { records, duplicates } = dedupeLatest(all);
const stats = computeStats(survey, records);
const expectedCopy = (m) => buildCopyText(survey, records, m, stats);
assert.equal(duplicates.length, 1);

// ---- static server for repo root (loopback only) ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
function staticServer() {
  const server = http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = path.join(root, p.endsWith('/') ? p + 'index.html' : p);
    if (!file.startsWith(root) || file.includes('node_modules') || file.includes('.git') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(STATIC, '127.0.0.1', () => r(server)));
}

let mock, web, chrome, cdp, tmp, blocked = [], errors = [];
const secrets = { report: REPORT, admin: ADMIN };
before(async () => {
  mock = await startMock({ port: MOCK, env: { REPORT_SECRET: REPORT, ADMIN_SECRET: ADMIN, ALLOWED_ORIGINS: `http://127.0.0.1:${STATIC}` } });
  web = await staticServer();
  const base = `http://127.0.0.1:${MOCK}`;
  let r = await fetch(`${base}/v1/admin/surveys/${survey.surveyId}`, { method: 'PUT', headers: { Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ version: survey.version, deadline: '2099-12-31T23:59:59+09:00', status: 'open' }) });
  assert.equal(r.status, 200);
  for (const p of payloads) assert.equal((await fetch(`${base}/v1/submit/${survey.surveyId}`, { method: 'POST', body: p })).status, 201);

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-chrome-'));
  chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${CDP}`, '--remote-allow-origins=*', `--user-data-dir=${tmp}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', detached: true });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await getJSON(`http://127.0.0.1:${CDP}/json/list`)).find((t) => t.type === 'page'); } catch { await delay(200); }
  }
  assert.ok(target, 'chrome did not start');
  cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
  await cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  cdp.setHandler((m) => {
    if (m.method === 'Fetch.requestPaused') {
      const u = m.params.request.url;
      const ok = !/^https?:/.test(u) || new URL(u).hostname === '127.0.0.1';
      if (!ok) blocked.push(u);
      cdp.call(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args).slice(0, 300));
  });
});
after(async () => {
  try { cdp?.close(); } catch {}
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((r) => chrome.once('exit', r));
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); } // only the process group we spawned
    await Promise.race([exited, delay(5000)]);
    await delay(500);
  }
  await mock?.close(); web?.close();
  try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp profile; best effort */ }
});

const ev = async (expression) => {
  const r = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
async function waitFor(expr, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ev(expr)) return; await delay(100); }
  throw new Error(`timeout: ${label}`);
}
async function open(width, height, mobile) {
  await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${STATIC}/reports/index.html?survey=${encodeURIComponent(SURVEY_PATH)}&collector=${encodeURIComponent(`http://127.0.0.1:${MOCK}`)}` });
  await waitFor(`document.readyState==='complete' && !!document.getElementById('load')`, 'page load');
  await ev(`sessionStorage.clear(); document.getElementById('secret').value=''; true`);
}

for (const [name, w, h, mobile] of [['mobile 390x844', 390, 844, true], ['desktop 1280x900', 1280, 900, false]]) {
  test(`reports page (${name}): collector source with runtime secret, views A-E, copy equals lib output`, async () => {
    errors.length = 0;
    await open(w, h, mobile);
    // wrong secret first
    await ev(`document.getElementById('secret').value='wrong'; document.getElementById('load').click(); true`);
    await waitFor(`document.getElementById('status').textContent.includes('비밀번호가 올바르지 않습니다')`, 'wrong secret message');
    assert.equal(await ev(`document.getElementById('report').hidden`), true);
    // right secret
    await ev(`document.getElementById('secret').value=${JSON.stringify(REPORT)}; document.getElementById('load').click(); true`);
    await waitFor(`!document.getElementById('report').hidden`, 'report visible');
    assert.equal(await ev(`document.getElementById('status').textContent`), `응답 ${all.length}건 불러옴 (집계 ${records.length}, 중복 ${duplicates.length})`);

    // secret storage: sessionStorage only
    assert.equal(await ev(`sessionStorage.getItem('sf-report-secret')`), REPORT);
    assert.equal(await ev(`JSON.stringify(localStorage)`), '{}');
    assert.ok(!(await ev(`location.href`)).includes(REPORT));

    // A
    assert.equal(await ev(`document.querySelectorAll('#tbl-responses tbody tr').length`), all.length);
    assert.equal(await ev(`document.querySelectorAll('#tbl-responses tbody tr.dup').length`), 1);
    assert.equal(await ev(`document.querySelectorAll('#tbl-responses tbody tr')[2].children[0].textContent`), all[2].ref);
    // B
    assert.equal(await ev(`document.getElementById('sum-n').textContent`), String(stats.n));
    assert.equal(await ev(`document.getElementById('sum-overall').textContent`), fmt1(stats.overall.avg));
    const catRows = await ev(`[...document.querySelectorAll('#tbl-cat tbody tr')].map(r=>[r.children[0].textContent,r.children[1].textContent])`);
    for (const c of stats.categories) assert.deepEqual(catRows.find((r) => r[0] === c), [c, String(stats.nByCategory[c])]);
    // C
    const rows = await ev(`[...document.querySelectorAll('#tbl-questions tbody tr')].map(r=>[r.dataset.q,r.children[2].textContent,r.children[4].textContent,r.children[5].textContent,r.children[6].textContent])`);
    assert.equal(rows.length, Object.keys(stats.questions).length);
    for (const [id, avg, valid, na, un] of rows) {
      const s = stats.questions[id];
      assert.deepEqual([avg, valid, na, un], [fmt1(s.avg), String(s.valid), String(s.na), String(s.unanswered)]);
    }
    // D (escaped, with linked scores)
    const lines = await ev(`[...document.querySelectorAll('#view-d ul[data-q="${linkedText.id}"] li')].map(li=>[li.querySelector('.prefix').textContent, li.querySelector('.body').textContent])`);
    const expectedLines = records.filter((r) => typeof r.answers[linkedText.id] === 'string' && r.answers[linkedText.id].trim())
      .map((r) => [linkedPrefix(survey, linkedText, r), r.answers[linkedText.id].trim()]);
    assert.deepEqual(lines, expectedLines);
    assert.ok(lines.some(([p]) => p.includes('평가안함')));
    assert.equal(await ev(`document.querySelectorAll('#view-d .body b').length`), 0);
    // tabs
    await ev(`document.querySelector('[data-tab=e]').click(); true`);
    assert.equal(await ev(`document.getElementById('view-e').hidden`), false);
    assert.equal(await ev(`document.getElementById('view-a').hidden`), true);
    // E: copy buttons
    for (const [btn, mode] of [['copy-all', 'all'], ['copy-scores', 'scores'], ['copy-text', 'text']]) {
      await ev(`document.getElementById('${btn}').click(); true`);
      await waitFor(`document.getElementById('copy-out').value.length>0 && document.getElementById('copy-status').textContent!==''`, btn);
      assert.equal(await ev(`document.getElementById('copy-out').value`), expectedCopy(mode), mode);
    }
    assert.equal(await ev(`document.getElementById('ai-prompt').value`), buildAiPrompt(survey, records, stats));
    // layout: no horizontal page scroll
    assert.ok(await ev(`document.documentElement.scrollWidth <= window.innerWidth`), 'horizontal overflow');
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
  });
}

test('reports page: local file upload (jsonl) path', async () => {
  await open(1280, 900, false);
  const f = path.join(tmp, 'resp.jsonl');
  fs.writeFileSync(f, payloads.join('\n') + '\n');
  await ev(`const s=document.getElementById('source'); s.value='file'; s.dispatchEvent(new Event('change')); true`);
  const doc = await cdp.call('DOM.getDocument', { depth: 1 });
  const { nodeId } = await cdp.call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file' });
  await cdp.call('DOM.setFileInputFiles', { nodeId, files: [f] });
  await ev(`document.getElementById('load').click(); true`);
  await waitFor(`!document.getElementById('report').hidden`, 'file report');
  assert.equal(await ev(`document.getElementById('sum-n').textContent`), String(stats.n));
  await ev(`document.getElementById('copy-all').click(); true`);
  await waitFor(`document.getElementById('copy-out').value.length>0`, 'copy');
  assert.equal(await ev(`document.getElementById('copy-out').value`), expectedCopy('all'));
  assert.equal(await ev(`sessionStorage.getItem('sf-report-secret')`), null); // no secret involved
  assert.deepEqual(blocked, []);
});

test('no secret string appears in any served static file', () => {
  const dirs = ['reports', 'lib', 'tools', 'collector', 'engine', 'schema'];
  const files = [];
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
  dirs.forEach((d) => walk(path.join(root, d)));
  assert.ok(files.length > 10);
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const s of [REPORT, ADMIN, 'test-report-secret', 'test-admin-secret']) assert.ok(!t.includes(s), `${f} contains a secret`);
  }
  // reports page never reads secrets from config: only from the input element
  const js = fs.readFileSync(path.join(root, 'reports/report.js'), 'utf8');
  assert.ok(!/localStorage/.test(js));
});
