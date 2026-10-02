import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { build, parseArgs, importsOf, libClosure, scanOutput, buildVercelJson, BuildError } from '../../tools/build-report-site.mjs';
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

// ---------- --embed-report-secret (FAKE secrets only, temp env files) ----------
const FAKE_REPORT = 'fake-rpt-4d9e1c7a2b', FAKE_ADMIN = 'fake-adm-91f3a8e6c0';
const envFile = (text) => { const f = fresh(`env-${Math.random().toString(36).slice(2)}`); fs.writeFileSync(f, text); return f; };
const FAKE_ENV = envFile(`# fake\nADMIN_SECRET=${FAKE_ADMIN}\nREPORT_SECRET=${FAKE_REPORT}\nOTHER=1\n`);
const refusesEmbed = (args, re) => assert.throws(() => build(args), (e) => e instanceof BuildError && re.test(e.message) && !e.message.includes(FAKE_REPORT) && !e.message.includes(FAKE_ADMIN), args.join(' '));

test('embed: off by default; on adds exactly reports/report-secret.json with only REPORT_SECRET', () => {
  const off = fresh('emb-off');
  assert.ok(!build(['--out', off, ...ARGS]).files.includes('reports/report-secret.json'));
  assert.ok(!fs.existsSync(path.join(off, 'reports/report-secret.json')));
  const out = fresh('emb-on');
  const r = build(['--out', out, ...ARGS, '--embed-report-secret', FAKE_ENV]);
  assert.equal(r.embeddedSecretChars, FAKE_REPORT.length);
  assert.deepEqual(listFiles(out), [...listFiles(off), 'reports/report-secret.json'].sort());
  assert.deepEqual(r.files, listFiles(out));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'reports/report-secret.json'), 'utf8')), { reportSecret: FAKE_REPORT });
  // the secret is in that one file only; config stays secret-free; admin secret is nowhere
  for (const f of listFiles(out)) {
    const t = fs.readFileSync(path.join(out, f), 'utf8');
    assert.equal(t.includes(FAKE_REPORT), f === 'reports/report-secret.json', f);
    assert.ok(!t.includes(FAKE_ADMIN), f);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'reports/report-config.json'), 'utf8')), { collector: COLLECTOR, surveyBase: BASE });
  // flag position / default path value forms; headers unchanged (everything no-store)
  const v = JSON.parse(fs.readFileSync(path.join(out, 'vercel.json'), 'utf8'));
  assert.equal(v.headers.find((h) => h.source === '/(.*)').headers.find((h) => h.key === 'Cache-Control').value, 'no-store');
  // rebuilding without the flag over an embedded build removes the file
  build(['--out', out, ...ARGS]);
  assert.ok(!fs.existsSync(path.join(out, 'reports/report-secret.json')));
});

test('embed: refuses when --out is inside the repo and not git-ignored (fails closed), allows git-ignored dist/ and outside dirs', () => {
  // throwaway repo with the files the builder needs but no .gitignore -> dist/ is not ignored
  const repo = fresh('repo-noignore');
  fs.mkdirSync(repo);
  for (const d of ['reports', 'lib', 'engine']) fs.cpSync(path.join(root, d), path.join(repo, d), { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const dist = path.join(repo, 'dist/site');
  assert.throws(() => build(['--out', dist, ...ARGS, '--embed-report-secret', FAKE_ENV], { repo }), (e) => e instanceof BuildError && /not git-ignored/.test(e.message));
  assert.ok(!fs.existsSync(dist), 'nothing is written when the embed is refused');
  assert.equal(build(['--out', dist, ...ARGS], { repo }).files.length, 16, 'the same dir is fine without the flag');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.writeFileSync(path.join(repo, '.gitignore'), 'dist/\n');
  assert.equal(build(['--out', dist, ...ARGS, '--embed-report-secret', FAKE_ENV], { repo }).files.length, 17);
  // not a git repo at all (inside it): git cannot answer -> refuse
  const plain = fresh('repo-nogit');
  fs.mkdirSync(plain);
  for (const d of ['reports', 'lib', 'engine']) fs.cpSync(path.join(root, d), path.join(plain, d), { recursive: true });
  assert.throws(() => build(['--out', path.join(plain, 'dist/site'), ...ARGS, '--embed-report-secret', FAKE_ENV], { repo: plain }), /not git-ignored/);
  // the real repo: dist/ is ignored
  const d = path.join(root, 'dist', `site-embed-${process.pid}`);
  try { assert.equal(build(['--out', d, ...ARGS, '--embed-report-secret', FAKE_ENV]).files.length, 17); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('embed: ADMIN_SECRET is never embedded; bad env files are refused without printing values', () => {
  const out = fresh('emb-bad');
  const bad = (text, re) => refusesEmbed(['--out', out, ...ARGS, '--embed-report-secret', envFile(text)], re);
  bad(`ADMIN_SECRET=${FAKE_ADMIN}\n`, /exactly one REPORT_SECRET/);
  bad(`REPORT_SECRET=${FAKE_REPORT}\nREPORT_SECRET=${FAKE_REPORT}x\n`, /exactly one REPORT_SECRET/);
  bad(`REPORT_SECRET=${FAKE_ADMIN}\nADMIN_SECRET=${FAKE_ADMIN}\n`, /overlaps ADMIN_SECRET/);
  bad(`REPORT_SECRET=${FAKE_ADMIN}-more\nADMIN_SECRET=${FAKE_ADMIN}\n`, /overlaps ADMIN_SECRET/);
  bad('REPORT_SECRET=short\n', /at least 8 printable/);
  bad('REPORT_SECRET=has space inside\n', /at least 8 printable/);
  refusesEmbed(['--out', out, ...ARGS, '--embed-report-secret', fresh('no-such-env')], /cannot read the secrets env file/);
  assert.ok(!fs.existsSync(out), 'nothing is written when the embed is refused');
  // quotes and `export` are accepted; only the REPORT_SECRET line is used
  const ok = fresh('emb-quoted');
  build(['--out', ok, ...ARGS, '--embed-report-secret', envFile(`export ADMIN_SECRET='${FAKE_ADMIN}'\nexport REPORT_SECRET="${FAKE_REPORT}"\n`)]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ok, 'reports/report-secret.json'), 'utf8')).reportSecret, FAKE_REPORT);
  // flag parsing: path is optional, never swallows the next option, and may not repeat
  assert.deepEqual(parseArgs(['--embed-report-secret', '--out', 'x']), { embedSecret: '/home/box/.config/survey-factory/collector-secrets.env', out: 'x' });
  assert.deepEqual(parseArgs(['--embed-report-secret', '/p/e.env', '--out', 'x']), { embedSecret: '/p/e.env', out: 'x' });
  assert.throws(() => parseArgs(['--embed-report-secret', 'a', '--embed-report-secret', 'b']), /duplicate/);
});

test('embed: scanner allows only the exact report-secret.json and still catches other leaks', () => {
  const mk = () => { const d = fresh(`embscan-${Math.random().toString(36).slice(2)}`); build(['--out', d, ...ARGS, '--embed-report-secret', FAKE_ENV]); return d; };
  const expected = listFiles(mk());
  const sec = { file: 'reports/report-secret.json', value: FAKE_REPORT, admin: [FAKE_ADMIN] };
  assert.doesNotThrow(() => scanOutput(mk(), expected, sec));
  // without the option the same tree is rejected (file is neither allowlisted nor allowed by name)
  assert.throws(() => scanOutput(mk(), expected), /forbidden output file/);
  assert.throws(() => scanOutput(mk(), expected.filter((f) => f !== sec.file)), /allowlist/);
  const put = (d, f, c) => fs.writeFileSync(path.join(d, f), c);
  const withEdit = (f, c) => { const d = mk(); put(d, f, c); return d; };
  assert.throws(() => scanOutput(withEdit(sec.file, JSON.stringify({ reportSecret: FAKE_ADMIN })), expected, sec), /must contain exactly/);
  assert.throws(() => scanOutput(withEdit(sec.file, JSON.stringify({ reportSecret: FAKE_REPORT, adminSecret: FAKE_ADMIN })), expected, sec), /must contain exactly/);
  assert.throws(() => scanOutput(withEdit(sec.file, 'not json'), expected, sec), /not valid JSON/);
  // the secret or the admin secret anywhere else fails the build, even in an otherwise allowed file
  assert.throws(() => scanOutput(withEdit('reports/report-config.json', `{"x":"${FAKE_REPORT}"}`), expected, sec), /value of a secret environment variable/);
  assert.throws(() => scanOutput(withEdit('lib/format.mjs', `// ${FAKE_ADMIN}`), expected, sec), /value of a secret environment variable/);
  // other secret-like content is still detected while the flag is on
  assert.throws(() => scanOutput(withEdit('lib/format.mjs', "const REPORT_SECRET = 'abcd1234efgh5678ijkl';"), expected, sec), /credential assignment/);
  assert.throws(() => scanOutput(withEdit('lib/format.mjs', 'x = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"'), expected, sec), /provider token/);
  // another secret-named file is not covered by the exception
  const extra = mk(); put(extra, 'reports/other-secret.json', '{}');
  assert.throws(() => scanOutput(extra, expected.concat('reports/other-secret.json'), sec), /forbidden output file/);
  const stray = mk(); put(stray, '.env', 'A=1');
  assert.throws(() => scanOutput(stray, expected, sec), /allowlist/);
});

test('embed CLI: prints only the char count, never the value; exit 2 on refusal', () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(root, 'tools/build-report-site.mjs'), ...a], { encoding: 'utf8' });
  const ok = run('--out', fresh('cli-emb'), ...ARGS, '--embed-report-secret', FAKE_ENV);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, new RegExp(`embedded REPORT_SECRET \\(${FAKE_REPORT.length} chars\\)`));
  assert.ok(!(ok.stdout + ok.stderr).includes(FAKE_REPORT) && !(ok.stdout + ok.stderr).includes(FAKE_ADMIN));
  const bad = run('--out', fresh('cli-emb-bad'), ...ARGS, '--embed-report-secret', envFile(`REPORT_SECRET=${FAKE_ADMIN}\nADMIN_SECRET=${FAKE_ADMIN}\n`));
  assert.equal(bad.status, 2);
  assert.ok(!(bad.stdout + bad.stderr).includes(FAKE_ADMIN));
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
