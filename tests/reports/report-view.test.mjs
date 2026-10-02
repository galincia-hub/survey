// Headless-browser test of the hosted report bundle: build -> serve with the generated vercel.json headers (real CSP) ->
// mock collector (same handle() as the Worker) + demo data -> assert the designed sections, the config prefill and the .xlsx download.
// One loopback port only: 18800 serves the bundle, /demo-001/survey.json and the collector API. SF_SCREENSHOT_DIR=<dir> also saves full-page PNGs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { browser } from '../browser.mjs';
import { build } from '../../tools/build-report-site.mjs';
import { handle } from '../../collector/core.mjs';
import { memoryStore } from '../../tools/mock-collector.mjs';
import { normalizeResponse, dedupeLatest } from '../../lib/normalize.mjs';
import { computeStats, choiceStats } from '../../lib/stats.mjs';
import { buildSheets, SHEET_NAMES } from '../../lib/xlsx-rows.mjs';
import { fmt1 } from '../../lib/format.mjs';
import { linkedPrefix } from '../../lib/format.mjs';
import { demoSurvey, demoPayloads } from '../helpers/report-demo.mjs';

const PORT = 18800, ORIGIN = `http://127.0.0.1:${PORT}`;
const REPORT = 'rpt-demo-secret-4c9e17aa', ADMIN = 'adm-demo-secret-90b2d3f1';
const CONFIG_COLLECTOR = 'https://collector.example', CONFIG_BASE = 'https://surveys.example/s/surveys/';
const survey = demoSurvey();
const payloads = demoPayloads(survey);
const all = payloads.map((p, i) => normalizeResponse(p, { id: i + 1, surveyId: survey.surveyId, receivedAt: JSON.parse(p).submittedAt }));
const { records, duplicates } = dedupeLatest(all);
const stats = computeStats(survey, records);
const choices = choiceStats(survey, records);
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

let tmp, site, server, b;
const store = memoryStore();
const env = { REPORT_SECRET: REPORT, ADMIN_SECRET: ADMIN, ALLOWED_ORIGINS: '' };
const hits = [];

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-report-site-'));
  site = path.join(tmp, 'site');
  build(['--out', site, '--collector', CONFIG_COLLECTOR, '--survey-base', CONFIG_BASE, '--default-survey', 'demo-001', '--surveys', 'demo-001,other-002']);
  const vercel = JSON.parse(fs.readFileSync(path.join(site, 'vercel.json'), 'utf8'));
  const headers = Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));
  const call = (p, init) => handle(new Request(ORIGIN + p, init), env, store);
  assert.equal((await call(`/v1/admin/surveys/${survey.surveyId}`, { method: 'PUT', headers: { Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ version: survey.version, deadline: '2099-12-31T23:59:59+09:00', status: 'open' }) })).status, 200);
  for (const p of payloads) assert.equal((await call(`/v1/submit/${survey.surveyId}`, { method: 'POST', body: p })).status, 201);

  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, ORIGIN);
      hits.push(url.pathname);
      if (url.pathname.startsWith('/v1/')) { // collector API (same-origin in this test)
        const init = { method: req.method, headers: req.headers };
        if (!['GET', 'HEAD'].includes(req.method)) init.body = Buffer.concat(chunks);
        const out = await handle(new Request(ORIGIN + req.url, init), env, store);
        res.writeHead(out.status, Object.fromEntries(out.headers));
        return res.end(Buffer.from(await out.arrayBuffer()));
      }
      if (url.pathname === '/demo-001/survey.json') { res.writeHead(200, { 'Content-Type': MIME['.json'] }); return res.end(JSON.stringify(survey)); }
      const rel = decodeURIComponent(url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname).replace(/^\/+/, '');
      const file = path.resolve(site, rel);
      const base = { ...headers };
      if (url.pathname === '/') { res.writeHead(307, { Location: '/reports/', ...base }); return res.end(); }
      if (!file.startsWith(site + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, base); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', ...base });
      res.end(fs.readFileSync(file));
    });
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(PORT, '127.0.0.1', r); });
  b = await browser();
  await b.cdp.call('Log.enable');
});
after(async () => {
  await b?.close();
  await new Promise((r) => { server?.close(r); server?.closeAllConnections?.(); if (!server) r(); });
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const q = (sel) => b.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const qa = (expr) => b.evaluate(expr);
async function open(width, height, mobile, query = '') {
  await b.cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  b.errors.length = 0; b.blocked.length = 0;
  await b.navigate(`${ORIGIN}/reports/${query}`);
  await b.wait(`document.readyState==='complete' && !!document.getElementById('load')`);
  await b.evaluate(`sessionStorage.clear(); true`);
}
const demoQuery = `?survey=${encodeURIComponent(`${ORIGIN}/demo-001/survey.json`)}&collector=${encodeURIComponent(ORIGIN)}`;
async function loadReport(w, h, mobile) {
  await open(w, h, mobile, demoQuery);
  await b.evaluate(`document.getElementById('secret').value=${JSON.stringify(REPORT)}; document.getElementById('load').click(); true`);
  await b.wait(`!document.getElementById('report').hidden && !!document.querySelector('#rp-title')`);
}
const cspViolations = () => b.cdp.events.filter((e) => e.method === 'Log.entryAdded' && /Content Security Policy|Refused to/i.test(e.params.entry.text ?? ''));

test('bundle served with generated CSP: redirect, headers, no inline style/script', async () => {
  const r = await fetch(`${ORIGIN}/`, { redirect: 'manual' });
  assert.equal(r.status, 307); assert.equal(r.headers.get('location'), '/reports/');
  const page = await fetch(`${ORIGIN}/reports/`);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /^default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:\/\/collector\.example https:\/\/surveys\.example;/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${ORIGIN}/lib/report-view.mjs`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  for (const f of ['.env', 'wrangler.toml', 'surveys/demo-001/survey.json', 'collector/core.mjs', 'tools/report.mjs']) assert.equal((await fetch(`${ORIGIN}/${f}`)).status, 404, f);
});

test('hosted config: prefills endpoint/survey (never the secret), datalist, surveyBase URL; URL params win', async () => {
  // config only: no URL params
  await open(1280, 900, false);
  await b.wait(`document.getElementById('endpoint').value!==''`);
  assert.equal(await qa(`document.getElementById('endpoint').value`), CONFIG_COLLECTOR);
  assert.equal(await qa(`document.getElementById('survey-url').value`), 'demo-001');
  assert.equal(await qa(`document.getElementById('secret').value`), '');
  assert.equal(await qa(`document.getElementById('survey-url').getAttribute('list')`), 'survey-ids');
  assert.deepEqual(await qa(`[...document.querySelectorAll('#survey-ids option')].map(o=>o.value)`), ['demo-001', 'other-002']);
  // a bare id resolves through surveyBase (the harness blocks the cross-origin request, which proves the URL)
  await b.evaluate(`document.getElementById('secret').value='x'; document.getElementById('load').click(); true`);
  await b.wait(`document.getElementById('status').className==='err'`);
  assert.deepEqual(b.blocked, [`${CONFIG_BASE}demo-001/survey.json`]);
  await b.evaluate(`document.getElementById('survey-url').value='other-002'; document.getElementById('load').click(); true`);
  await b.wait(`document.getElementById('status').className==='err'`);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(b.blocked.includes(`${CONFIG_BASE}other-002/survey.json`));
  // URL params still win over the config
  await open(1280, 900, false, demoQuery);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await qa(`document.getElementById('endpoint').value`), ORIGIN);
  assert.equal(await qa(`document.getElementById('survey-url').value`), `${ORIGIN}/demo-001/survey.json`);
  // the secret is only ever restored from sessionStorage, never from config
  await b.evaluate(`sessionStorage.setItem('sf-report-secret','from-session'); true`);
  await open(1280, 900, false);
  await b.evaluate(`sessionStorage.setItem('sf-report-secret','from-session'); true`);
  await b.navigate(`${ORIGIN}/reports/`);
  await b.wait(`document.readyState==='complete' && document.getElementById('endpoint').value!==''`);
  assert.equal(await qa(`document.getElementById('secret').value`), 'from-session');
  const cfgText = fs.readFileSync(path.join(site, 'reports/report-config.json'), 'utf8');
  assert.ok(!cfgText.includes(REPORT) && !/secret/i.test(cfgText));
});

test('local preview mode without report-config.json keeps working (404 ignored)', async () => {
  const cfgPath = path.join(site, 'reports/report-config.json');
  const saved = fs.readFileSync(cfgPath);
  fs.rmSync(cfgPath);
  try {
    await open(1280, 900, false);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await qa(`document.getElementById('endpoint').value`), '');
    assert.equal(await qa(`document.getElementById('survey-url').value`), '');
    assert.equal(await qa(`document.querySelectorAll('#survey-ids option').length`), 0);
    assert.deepEqual(b.errors, []);
  } finally { fs.writeFileSync(cfgPath, saved); }
});

for (const [name, w, h, mobile] of [['desktop 1280x900', 1280, 900, false], ['mobile 390x844', 390, 844, true]]) {
  test(`designed report renders from mock collector data (${name})`, async () => {
    await loadReport(w, h, mobile);
    // header
    assert.equal(await q('#rp-title'), survey.title);
    assert.equal(await q('#rp-event'), survey.eventName);
    assert.match(await q('#rp-period'), /행사일2026-09-29/);
    assert.match(await q('#rp-period'), /응답 마감2026-10-06 23:59 \(\+09:00\)/);
    assert.equal(await q('#rp-count'), `${records.length}건`);
    assert.equal(await qa(`document.documentElement.dataset.theme ?? ''`), ''); // survey.theme "default" -> base skin
    assert.equal(await q('#title'), '설문 리포트');
    // KPI cards
    assert.equal(await q('#kpi-count .big'), String(stats.n));
    assert.match(await q('#kpi-count .sub'), new RegExp(`집계 ${records.length} / 수신 ${all.length} · 중복 ${duplicates.length}`));
    assert.equal(duplicates.length, 1);
    assert.match(await q('#kpi-overall .big'), new RegExp(`^${fmt1(stats.overall.avg)}[▲▼＝] `));
    assert.match(await q('#kpi-overall .sub'), new RegExp(`기준 ${survey.scale.baseline}점 \\(${survey.scale.baselineLabel}\\)`));
    const overallDir = await qa(`document.querySelector('#kpi-overall .delta').className`);
    assert.equal(overallDir, `delta ${stats.overall.avg - survey.scale.baseline > 0.05 ? 'up' : stats.overall.avg - survey.scale.baseline < -0.05 ? 'down' : 'flat'}`);
    assert.equal(await qa(`document.querySelectorAll('#kpi-overall svg .bar-base').length`), 1);
    const areaIds = Object.keys(stats.areas);
    assert.deepEqual(await qa(`[...document.querySelectorAll('.kpi.sec')].map(e=>e.id)`), areaIds.map((id) => `kpi-area-${id}`));
    for (const id of areaIds) assert.match(await q(`#kpi-area-${id} .big`), new RegExp(`^${fmt1(stats.areas[id].avg)}`));
    // themes: survey sections keep their own theme, the extra one cycles
    assert.deepEqual(await qa(`[...document.querySelectorAll('#rp-scores .secard')].map(e=>e.dataset.theme)`), ['sage', 'soft-blue', 'warm-beige', 'lavender']);
    assert.deepEqual(await qa(`[...document.querySelectorAll('#rp-choices .secard')].map(e=>e.dataset.theme)`), ['sage']); // 5th section has no theme -> cycle
    // per-section / per-question bars
    const qrows = await qa(`[...document.querySelectorAll('#rp-scores .qrow')].map(r=>({id:r.dataset.q,avg:r.querySelector('.qval b').textContent,meta:r.querySelector('.qmeta').textContent,base:r.querySelectorAll('svg .bar-base').length,fill:r.querySelector('svg .bar-fill')?.getAttribute('width')}))`);
    assert.equal(qrows.length, Object.keys(stats.questions).length);
    for (const r of qrows) {
      const s = stats.questions[r.id];
      assert.equal(r.avg, fmt1(s.avg));
      assert.match(r.meta, new RegExp(`유효 ${s.valid} · 평가 어려움 ${s.na}`));
      assert.equal(r.base, 1);
      assert.equal(Number(r.fill), Math.round(((s.avg - 0) / 20) * 10000) / 100);
    }
    assert.ok(qrows.some((r) => /평가 어려움 [1-9]/.test(r.meta)), 'fixture includes NA answers');
    // choices
    for (const id of ['X01', 'X02']) {
      const rows = await qa(`[...document.querySelectorAll('#choice-${id} li[data-option]')].map(li=>[li.dataset.option, li.querySelector('.ocount b').textContent, li.querySelector('.ocount .muted').textContent])`);
      assert.deepEqual(rows, choices[id].options.map((o) => [o.option, String(o.count), `${fmt1(o.pct)}%`]));
    }
    assert.ok(choices.X02.multi && !choices.X01.multi);
    // group comparison: groups with 0 responses are hidden
    const withResp = stats.categories.filter((c) => stats.nByCategory[c] > 0);
    assert.equal(withResp.length, 3); assert.ok(stats.categories.length > 3);
    assert.deepEqual(await qa(`[...document.querySelectorAll('#tbl-compare thead th[data-group]')].map(th=>th.dataset.group)`), withResp);
    assert.match(await q('#tbl-compare thead th[data-group] .muted'), /^n=\d+$/);
    const rowsCmp = await qa(`[...document.querySelectorAll('#tbl-compare tbody tr.qcmp')].map(r=>[r.dataset.q,...[...r.querySelectorAll('td b')].map(x=>x.textContent)])`);
    assert.equal(rowsCmp.length, Object.keys(stats.questions).length);
    for (const [id, ...vals] of rowsCmp) assert.deepEqual(vals, withResp.map((c) => fmt1(stats.questions[id].byCategory[c].avg)));
    assert.deepEqual(await qa(`[...document.querySelectorAll('#tbl-compare tbody tr.all td b')].map(x=>x.textContent)`), withResp.map((c) => fmt1(stats.overallByCategory[c])));
    // comments: grouped by question, with linked scores and category, escaped
    const textQs = survey.sections.flatMap((s) => s.questions).filter((x) => x.type === 'text');
    for (const tq of textQs) {
      const expected = records.filter((r) => typeof r.answers[tq.id] === 'string' && r.answers[tq.id].trim());
      const got = await qa(`[...document.querySelectorAll('#cmt-${tq.id} .cm')].map(li=>({cat:li.querySelector('.chip.cat').textContent,chips:[...li.querySelectorAll('.chip:not(.cat)')].map(c=>c.textContent),text:li.querySelector('.cm-text').textContent}))`);
      assert.equal(got.length, expected.length, tq.id);
      assert.match(await q(`#cmt-${tq.id} h3 .count`), new RegExp(`^${expected.length}건$`));
      got.forEach((g, i) => {
        const r = expected[i];
        assert.equal(g.cat, r.category);
        assert.equal(g.text, r.answers[tq.id].trim());
        assert.equal(`[${[g.cat, g.chips.join(' · ')].filter(Boolean).join(' | ')}]`, linkedPrefix(survey, tq, r));
      });
    }
    assert.ok(await qa(`!!document.querySelector('#rp-comments .chip.na')`), 'NA linked score chip');
    assert.equal(await qa(`document.querySelectorAll('#rp-comments img, #rp-comments b').length`), 0);
    assert.ok((await qa(`document.querySelector('#rp-comments').textContent`)).includes('<img src=x onerror=alert(1)>'));
    // existing data/copy tabs are still available
    assert.equal(await qa(`document.getElementById('data-details').open`), false);
    assert.equal(await qa(`document.querySelectorAll('#tbl-responses tbody tr').length`), all.length);
    await b.evaluate(`document.querySelector('[data-tab=e]').click(); true`);
    assert.equal(await qa(`document.getElementById('view-e').hidden`), false);
    assert.ok((await qa(`document.getElementById('ai-prompt').value`)).includes(survey.title));
    // no inline styles, no horizontal page scroll, no errors, no blocked or CSP-violating requests
    assert.equal(await qa(`document.querySelectorAll('[style]').length`), 0);
    assert.ok(await qa(`document.documentElement.scrollWidth <= window.innerWidth`), `horizontal overflow: ${await qa('document.documentElement.scrollWidth')} > ${w}`);
    assert.deepEqual(b.errors, []);
    assert.deepEqual(b.blocked, []);
    assert.deepEqual(cspViolations().map((e) => e.params.entry.text), []);
    if (mobile) {
      assert.equal(await qa(`getComputedStyle(document.querySelector('.kpis')).gridTemplateColumns.split(' ').length`), 1, 'single-column KPI grid on mobile');
      assert.ok(await qa(`document.querySelector('#rp-groups .scroll').scrollWidth > document.querySelector('#rp-groups .scroll').clientWidth`), 'wide table scrolls inside its container');
    }
  });
}

test('Excel download button produces a valid workbook with the tools/report.mjs sheet structure', async () => {
  await loadReport(1280, 900, false);
  await b.evaluate(`(() => { window.__dl = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (blob) => { window.__dl.push({ blob, type: blob.type }); return o(blob); };
    const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dl.at(-1).name = this.download; return c.call(this); }; return true; })()`);
  await b.evaluate(`document.getElementById('download-xlsx').click(); true`);
  await b.wait(`window.__dl.length===1 && window.__dl[0].name`);
  const meta = await qa(`({ name: __dl[0].name, type: __dl[0].type, size: __dl[0].blob.size })`);
  assert.equal(meta.name, `${survey.surveyId}-report.xlsx`);
  assert.equal(meta.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(meta.size > 1000);
  const b64 = await qa(`new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(__dl[0].blob); })`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b64, 'base64'));
  assert.deepEqual(wb.worksheets.map((w) => w.name), SHEET_NAMES);
  // expected = what the page loaded from the collector (envelope ids are generated by the collector)
  const env = (await (await fetch(`${ORIGIN}/v1/responses/${survey.surveyId}`, { headers: { Authorization: `Bearer ${REPORT}` } })).json()).responses;
  const loaded = env.map((e) => normalizeResponse(e.raw, { id: e.id, surveyId: e.surveyId, receivedAt: e.receivedAt }));
  assert.equal(loaded.length, all.length);
  const sheets = buildSheets(survey, loaded);
  const norm = (v) => (v === null || v === undefined ? '' : v);
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.getWorksheet(name);
    assert.equal(ws.rowCount, rows.length, name);
    rows.forEach((row, r) => row.forEach((v, c) => assert.equal(norm(ws.getRow(r + 1).getCell(c + 1).value), norm(v), `${name} r${r + 1}c${c + 1}`)));
  }
  // raw sheet keeps every response (incl. the duplicate); responses sheet is deduplicated
  assert.equal(wb.getWorksheet('raw').rowCount, all.length + 1);
  assert.equal(wb.getWorksheet('responses').rowCount, records.length + 1);
  assert.match(await qa(`document.getElementById('status').textContent`), /Excel/);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(cspViolations().map((e) => e.params.entry.text), []);
});

test('wrong password shows an error and no report', async () => {
  await open(1280, 900, false, demoQuery);
  await b.evaluate(`document.getElementById('secret').value='nope'; document.getElementById('load').click(); true`);
  await b.wait(`document.getElementById('status').textContent.includes('비밀번호가 올바르지 않습니다')`);
  assert.equal(await qa(`document.getElementById('report').hidden`), true);
  assert.equal(await qa(`document.getElementById('inputs').open`), true);
});

const shotDir = process.env.SF_SCREENSHOT_DIR;
test('screenshots of the demo report (only with SF_SCREENSHOT_DIR)', { skip: !shotDir && 'set SF_SCREENSHOT_DIR to save PNGs' }, async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  for (const [file, w, h, mobile] of [['report-desktop.png', 1280, 900, false], ['report-mobile.png', 390, 844, true]]) {
    await loadReport(w, h, mobile);
    await b.evaluate(`scrollTo(0,0); true`);
    await new Promise((r) => setTimeout(r, 400));
    const { cssContentSize } = await b.cdp.call('Page.getLayoutMetrics');
    const { data } = await b.cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.ceil(cssContentSize.height), scale: 1 } });
    fs.writeFileSync(path.join(shotDir, file), Buffer.from(data, 'base64'));
  }
});
