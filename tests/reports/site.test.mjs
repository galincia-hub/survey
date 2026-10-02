import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { build, importsOf, libClosure, scanOutput, buildVercelJson, BuildError } from '../../tools/build-report-site.mjs';
import { parseReportConfig, surveyUrlFrom } from '../../lib/report-config.mjs';
import { buildXlsx, crc32, colName } from '../../lib/xlsx-writer.mjs';
import { buildSheets, SHEET_NAMES } from '../../lib/xlsx-rows.mjs';
import { choiceStats } from '../../lib/stats.mjs';
import { renderDashboard, fmtWhen } from '../../lib/report-view.mjs';
import { dedupeLatest } from '../../lib/normalize.mjs';
import { computeStats } from '../../lib/stats.mjs';
import { demoSurvey, demoRecords } from '../helpers/report-demo.mjs';

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const COLLECTOR = 'https://collector.example', BASE = 'https://surveys.example/s/surveys/';
const ARGS = ['--collector', COLLECTOR, '--survey-base', BASE];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-site-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });
const fresh = (name) => path.join(tmp, name);
const listFiles = (dir) => { const out = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? w(p) : out.push(path.relative(dir, p).split(path.sep).join('/')); } })(dir); return out.sort(); };

// ---------- builder ----------
test('builder output: exact file list, only the modules report.js needs', () => {
  const out = fresh('list');
  const r = build(['--out', out, ...ARGS]);
  const lib = ['copytext', 'format', 'normalize', 'prompt', 'report-config', 'report-view', 'sources', 'stats', 'xlsx-rows', 'xlsx-writer'].map((m) => `lib/${m}.mjs`);
  const expected = ['engine/themes.css', ...lib, 'reports/index.html', 'reports/report-config.json', 'reports/report.js', 'reports/styles.css', 'vercel.json'].sort();
  assert.deepEqual(listFiles(out), expected);
  assert.deepEqual(r.files, expected);
  assert.deepEqual(libClosure().map((f) => f.replace(/^lib\//, '').replace(/\.mjs$/, '')), lib.map((f) => f.slice(4, -4)));
  // modules not used by the page are not shipped (tools, collector, intake...)
  for (const f of ['lib/intake.mjs', 'lib/kakao.mjs', 'lib/url.mjs']) assert.ok(!expected.includes(f));
  for (const f of expected.filter((x) => x.startsWith('lib/') || x.startsWith('reports/') && !x.endsWith('.json'))) {
    if (f.endsWith('.json') || f.endsWith('.html') || f.endsWith('.css')) continue;
    assert.equal(fs.readFileSync(path.join(out, f), 'utf8'), fs.readFileSync(path.join(root, f), 'utf8'), `${f} must be a verbatim copy`);
  }
});

test('builder config contents (all options, and minimal)', () => {
  const out = fresh('cfg');
  build(['--out', out, ...ARGS, '--default-survey', 'sample-001', '--surveys', 'sample-001, other-002,sample-001']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'reports/report-config.json'), 'utf8')), { collector: COLLECTOR, surveyBase: BASE, defaultSurvey: 'sample-001', surveys: ['sample-001', 'other-002'] });
  const min = fresh('cfg-min');
  build(['--out', min, '--collector', `${COLLECTOR}/`, '--survey-base', BASE]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(min, 'reports/report-config.json'), 'utf8')), { collector: COLLECTOR, surveyBase: BASE });
  // config never carries a secret-ish field
  assert.ok(!/secret|password|token/i.test(fs.readFileSync(path.join(out, 'reports/report-config.json'), 'utf8')));
});

test('builder vercel.json: redirect, CSP, security headers', () => {
  const out = fresh('vercel');
  build(['--out', out, ...ARGS]);
  const v = JSON.parse(fs.readFileSync(path.join(out, 'vercel.json'), 'utf8'));
  assert.deepEqual(v.redirects, [{ source: '/', destination: '/reports/', permanent: false }]);
  const all = v.headers.find((h) => h.source === '/(.*)');
  const hv = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
  assert.equal(hv['Content-Security-Policy'], `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${COLLECTOR} https://surveys.example; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`);
  assert.equal(hv['X-Frame-Options'], 'DENY');
  assert.equal(hv['Referrer-Policy'], 'no-referrer');
  assert.equal(hv['X-Content-Type-Options'], 'nosniff');
  assert.equal(hv['Cache-Control'], 'no-store');
  assert.deepEqual(v.headers.find((h) => h.source === '/lib/(.*)').headers, [{ key: 'Content-Type', value: 'text/javascript; charset=utf-8' }]);
  // no inline script/style allowance anywhere
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(hv['Content-Security-Policy']));
  // same origin for collector and survey host -> one connect-src entry
  assert.match(buildVercelJson({ collector: 'https://a.example', surveyBase: 'https://a.example/x/' }).headers[0].headers[0].value, /connect-src 'self' https:\/\/a\.example;/);
  // page and modules use no inline handlers/styles/scripts
  const html = fs.readFileSync(path.join(out, 'reports/index.html'), 'utf8');
  assert.ok(!/\son[a-z]+=|<script(?![^>]*\ssrc=)|\sstyle=|<style/i.test(html));
});

test('builder rejects bad arguments', () => {
  const bad = (args, re) => assert.throws(() => build(args), (e) => e instanceof BuildError && re.test(e.message), args.join(' '));
  const out = fresh('bad');
  bad([], /--out is required/);
  bad(['--out', out], /--collector is required/);
  bad(['--out', out, '--collector', COLLECTOR], /--survey-base is required/);
  bad(['--out', out, '--collector', 'http://collector.example', '--survey-base', BASE], /bare https origin/);
  bad(['--out', out, '--collector', 'https://collector.example/path', '--survey-base', BASE], /bare https origin/);
  bad(['--out', out, '--collector', 'https://user:pw@collector.example', '--survey-base', BASE], /bare https origin/);
  bad(['--out', out, '--collector', 'https://collector.example?x=1', '--survey-base', BASE], /bare https origin/);
  bad(['--out', out, '--collector', 'https://collector.example#f', '--survey-base', BASE], /bare https origin/);
  bad(['--out', out, '--collector', COLLECTOR, '--survey-base', 'http://surveys.example/s/'], /--survey-base/);
  bad(['--out', out, '--collector', COLLECTOR, '--survey-base', 'https://surveys.example/s'], /ending with/);
  bad(['--out', out, '--collector', COLLECTOR, '--survey-base', 'https://u:p@surveys.example/s/'], /--survey-base/);
  bad(['--out', out, '--collector', COLLECTOR, '--survey-base', 'https://surveys.example/s/?k=1'], /--survey-base/);
  bad(['--out', out, ...ARGS, '--default-survey', 'Bad_ID'], /--default-survey/);
  bad(['--out', out, ...ARGS, '--surveys', 'ok-1,../etc'], /invalid id/);
  bad(['--out', out, ...ARGS, '--bogus', 'x'], /unknown argument/);
  bad(['--out', out, ...ARGS, '--surveys'], /missing value/);
  bad(['--out', out, '--out', out, ...ARGS], /duplicate/);
  assert.ok(!fs.existsSync(out), 'nothing is written when arguments are rejected');
});

test('builder refuses out dirs inside the repo except under dist/, and non-empty foreign dirs', () => {
  const refuse = (out, re) => assert.throws(() => build(['--out', out, ...ARGS]), (e) => e instanceof BuildError && re.test(e.message), out);
  refuse(root, /contains the repository|inside the repository/);
  refuse(path.join(root, 'reports/site'), /only dist\//);
  refuse(path.join(root, 'site'), /only dist\//);
  refuse(path.join(root, 'dist'), /subdirectory of dist/);
  refuse(path.dirname(root), /contains the repository/);
  // symlink pointing into the repo is resolved
  const link = fresh('link-into-repo');
  fs.symlinkSync(path.join(root, 'reports'), link);
  refuse(path.join(link, 'x'), /only dist\//);
  // foreign non-empty dir
  const foreign = fresh('foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'keep.txt'), 'mine');
  refuse(foreign, /not empty/);
  assert.equal(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8'), 'mine');
  // under dist/ is fine (and gitignored)
  const d = path.join(root, 'dist', `site-test-${process.pid}`);
  try { assert.equal(build(['--out', d, ...ARGS]).files.length, 16); assert.equal(build(['--out', d, ...ARGS]).files.length, 16, 'rebuild over a previous build'); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('builder CLI: exit code 2 with usage on bad args, 0 on success', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(root, 'tools/build-report-site.mjs'), ...a], { encoding: 'utf8' });
  const bad = run('--out', fresh('cli-bad'), '--collector', 'http://x');
  assert.equal(bad.status, 2); assert.match(bad.stderr, /usage:/);
  const ok = run('--out', fresh('cli-ok'), ...ARGS, '--default-survey', 'demo-001');
  assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /built 16 files/);
});

test('builder scan: files off the allowlist and secret-like content fail the build', () => {
  const mk = (extra) => { const d = fresh(`scan-${Math.random().toString(36).slice(2)}`); build(['--out', d, ...ARGS]); for (const [f, c] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; };
  const expected = listFiles(mk({}));
  const scan = (extra) => scanOutput(mk(extra), expected.concat(Object.keys(extra)));
  const rejects = (extra, re) => assert.throws(() => scanOutput(mk(extra), expected), (e) => e instanceof BuildError && re.test(e.message));
  rejects({ '.env': 'A=1' }, /allowlist/);
  rejects({ 'wrangler.toml': 'x' }, /allowlist/);
  rejects({ 'responses.jsonl': '{}' }, /allowlist/);
  rejects({ 'surveys/x/survey.json': '{}' }, /allowlist/);
  // even if someone allowlisted them, forbidden names and secret-looking content still fail
  assert.throws(() => scan({ '.env': 'A=1' }), /forbidden output file/);
  assert.throws(() => scan({ 'surveys/x/survey.json': '{}' }), /forbidden output file/);
  assert.throws(() => scan({ 'lib/leak.mjs': "const REPORT_SECRET = 'abcd1234efgh5678ijkl';" }), /credential assignment/);
  assert.throws(() => scan({ 'lib/leak.mjs': "fetch(u,{headers:{Authorization:'Bearer abcdEFGH1234567890abcdEFGH'}})" }), /bearer literal/);
  assert.throws(() => scan({ 'lib/leak.mjs': '-----BEGIN PRIVATE KEY-----' }), /private key/);
  assert.throws(() => scan({ 'lib/leak.mjs': 'x = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"' }), /provider token/);
  assert.throws(() => scan({ 'lib/leak.mjs': 'x = "https://user:hunter2@host.example/"' }), /credentials in URL/);
  assert.throws(() => scan({ 'lib/leak.mjs': `x = "${'aB3'.repeat(15)}"` }), /high-entropy/);
  const prev = process.env.REPORT_SECRET;
  process.env.REPORT_SECRET = 'rpt-env-secret-value';
  try { assert.throws(() => scan({ 'lib/leak.mjs': '// rpt-env-secret-value' }), /value of a secret environment variable/); } finally { prev === undefined ? delete process.env.REPORT_SECRET : (process.env.REPORT_SECRET = prev); }
  // the real shipped files pass (no false positives)
  assert.doesNotThrow(() => scanOutput(mk({}), expected));
  assert.ok(!listFiles(mk({})).some((f) => /secret|\.env|wrangler|response|survey\.json/i.test(f)));
});

test('importsOf: static imports/re-exports only; dynamic import is refused', () => {
  assert.deepEqual(importsOf("import a from './a.mjs';\nimport { b, c } from '../lib/b.mjs'\nimport './side.mjs';\nexport * from './d.mjs';\nconst s = \"import x from 'nope'\";"), ['./a.mjs', '../lib/b.mjs', './side.mjs', './d.mjs']);
  assert.throws(() => importsOf("const m = await import('./x.mjs')"), BuildError);
});

// ---------- report-config / surveyUrlFrom ----------
test('report-config validation and surveyUrlFrom', () => {
  assert.deepEqual(parseReportConfig(null), {});
  assert.deepEqual(parseReportConfig([]), {});
  assert.deepEqual(parseReportConfig({ collector: 'https://c.example', surveyBase: 'https://s.example/p/', defaultSurvey: 'a-1', surveys: ['a-1', 'b-2', 'a-1'], extra: 1 }),
    { collector: 'https://c.example', surveyBase: 'https://s.example/p/', defaultSurvey: 'a-1', surveys: ['a-1', 'b-2'] });
  // invalid fields are dropped individually
  assert.deepEqual(parseReportConfig({ collector: 'http://c.example', surveyBase: 'https://s.example/p', defaultSurvey: 'Bad', surveys: ['ok', 'No Good', 5] }), { surveys: ['ok'] });
  for (const c of ['https://c.example/x', 'https://u:p@c.example', 'https://c.example?q=1', 'javascript:alert(1)', 'ftp://c.example', 'c.example', 5]) assert.equal(parseReportConfig({ collector: c }).collector, undefined, String(c));
  assert.equal(parseReportConfig({ surveyBase: 'https://s.example/p/?x=1' }).surveyBase, undefined);
  // surveyUrlFrom
  assert.equal(surveyUrlFrom('demo-001'), '../surveys/demo-001/survey.json');
  assert.equal(surveyUrlFrom(' demo-001 ', { surveyBase: 'https://s.example/p/' }), 'https://s.example/p/demo-001/survey.json');
  assert.equal(surveyUrlFrom('https://other.example/x/survey.json', { surveyBase: 'https://s.example/p/' }), 'https://other.example/x/survey.json');
  assert.equal(surveyUrlFrom('../surveys/x/survey.json', { surveyBase: 'https://s.example/p/' }), '../surveys/x/survey.json');
  assert.equal(surveyUrlFrom('', { surveyBase: 'https://s.example/p/' }), '');
});

// ---------- choiceStats ----------
test('choiceStats: single/multi counts, pct of answering respondents, unknown values, unanswered', () => {
  const sv = demoSurvey();
  const mk = (a) => ({ answers: a });
  const cs = choiceStats(sv, [mk({ X01: '당일', X02: ['객실', '스파'] }), mk({ X01: '당일', X02: ['객실'] }), mk({ X01: '2박 3일', X02: [] }), mk({ X01: '', X02: ['없는값'] }), mk({})]);
  assert.deepEqual(Object.keys(cs), ['X01', 'X02']);
  assert.deepEqual(cs.X01.options.map((o) => [o.option, o.count]), [['당일', 2], ['1박 2일', 0], ['2박 3일', 1]]);
  assert.equal(cs.X01.answered, 3); assert.equal(cs.X01.unanswered, 2); assert.equal(cs.X01.multi, false);
  assert.ok(Math.abs(cs.X01.options[0].pct - 66.6667) < 0.001);
  assert.deepEqual(cs.X02.options.map((o) => [o.option, o.count]), [['객실', 2], ['스파', 1], ['키즈클럽', 0], ['엔터테인먼트', 0]]);
  assert.equal(cs.X02.answered, 3); assert.equal(cs.X02.other, 1); assert.equal(cs.X02.multi, true);
  assert.equal(cs.X02.options[0].pct, (2 / 3) * 100);
  // prototype-ish option names are plain strings
  const odd = { sections: [{ id: 's', title: 's', questions: [{ id: 'C', type: 'singleChoice', prompt: 'p', options: ['constructor', 'b'] }] }] };
  assert.deepEqual(choiceStats(odd, [mk({ C: 'constructor' }), mk({ C: '__proto__' })]).C.options.map((o) => o.count), [1, 0]);
  assert.equal(choiceStats(odd, []).C.options[0].pct, null);
});

// ---------- view (pure) ----------
test('renderDashboard: escapes all text, no inline style attributes, sections present', () => {
  const survey = demoSurvey();
  const all = demoRecords(survey);
  const { records, duplicates } = dedupeLatest(all);
  const stats = computeStats(survey, records);
  const html = renderDashboard({ survey, all, records, duplicates, stats });
  assert.ok(!/<img\s/i.test(html), 'comment markup must be escaped');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!/\sstyle=/i.test(html));
  assert.ok(!/\son[a-z]+=/i.test(html.replace(/&lt;[^&]*&gt;/g, '')));
  for (const id of ['rp-header', 'rp-kpis', 'rp-scores', 'rp-choices', 'rp-groups', 'rp-comments', 'kpi-count', 'kpi-overall', 'tbl-compare']) assert.ok(html.includes(`id="${id}"`), id);
  const hostile = structuredClone(survey); hostile.title = '"><script>x</script>'; hostile.eventName = '<b>e</b>';
  assert.ok(!renderDashboard({ survey: hostile, all, records, duplicates, stats }).includes('<script>'));
  assert.equal(fmtWhen('2026-10-06T23:59:59+09:00'), '2026-10-06 23:59 (+09:00)');
  assert.equal(fmtWhen('2026-09-29'), '2026-09-29');
  assert.equal(fmtWhen('soon'), 'soon');
});

test('renderDashboard: single group / no responses hides the comparison, empty survey data does not throw', () => {
  const survey = demoSurvey();
  const one = demoRecords(survey).filter((r) => r.category === survey.respondent.options[0]);
  const html = renderDashboard({ survey, all: one, records: one, duplicates: [], stats: computeStats(survey, one) });
  assert.ok(!html.includes('id="rp-groups"'));
  const none = renderDashboard({ survey, all: [], records: [], duplicates: [], stats: computeStats(survey, []) });
  assert.ok(none.includes('id="kpi-count"') && !none.includes('NaN') && !none.includes('undefined'));
});

// ---------- xlsx writer ----------
test('crc32 / colName', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
});

test('xlsx writer: valid workbook, same sheets and values as tools/report.mjs buildSheets', async () => {
  const survey = demoSurvey();
  const sheets = buildSheets(survey, demoRecords(survey));
  assert.deepEqual(Object.keys(sheets), SHEET_NAMES);
  const bytes = buildXlsx(sheets);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4B);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(wb.worksheets.map((w) => w.name), SHEET_NAMES);
  const norm = (v) => (v === null || v === undefined ? '' : v);
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.getWorksheet(name);
    assert.equal(ws.rowCount, rows.length, `${name} rows`);
    rows.forEach((row, r) => row.forEach((v, c) => assert.equal(norm(ws.getRow(r + 1).getCell(c + 1).value), norm(v), `${name}!${colName(c)}${r + 1}`)));
    assert.equal(ws.getCell('A1').font?.bold, true, `${name} header bold`);
  }
});

test('xlsx writer: hostile strings, control chars, booleans, non-finite numbers, bad sheet names', async () => {
  const bytes = buildXlsx({ s: [['h'], ['=1+1'], ['<&>"\u0001x'], ['한글 \n줄바꿈'], [true], [NaN], ['a'.repeat(40000)]] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  const ws = wb.getWorksheet('s');
  assert.equal(ws.getCell('A2').value, '=1+1'); // text, never a formula
  assert.equal(ws.getCell('A3').value, '<&>"x');
  assert.equal(ws.getCell('A4').value, '한글 \n줄바꿈');
  assert.equal(ws.getCell('A5').value, true);
  assert.equal(ws.getCell('A6').value, null);
  assert.equal(ws.getCell('A7').value.length, 32767);
  for (const n of ['', 'x'.repeat(32), 'a/b', 'a[b]', 'a:b']) assert.throws(() => buildXlsx({ [n]: [['x']] }), /sheet name/);
  assert.throws(() => buildXlsx({}), /at least one sheet/);
});
