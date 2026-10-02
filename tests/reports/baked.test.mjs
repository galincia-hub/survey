import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { buildBaked, readRawRows, readXlsxBuffer, wallTime } from '../../tools/sync-gform-sheet.mjs';
import { build } from '../../tools/build-report-site.mjs';
import { parseReportConfig } from '../../lib/report-config.mjs';
import { parseGformCsv } from '../../lib/sources.mjs';

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const survey = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/surveys/adora-ship-visit-001.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-baked-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });
const payload = (n) => JSON.stringify({ version: 'v1', ref: '', affiliation: '기타', answers: { O01: n, R01: `의견, "${n}"` }, submittedAt: '2026-10-02T01:00:00.000Z' });

async function sheetXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('응답 보기').addRow(['타임스탬프', 'ref']);
  const ws = wb.addWorksheet('설문지 응답 시트1');
  ws.addRow(['타임스탬프', 'payload']);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('wallTime: excel dates and Korean sheet strings', () => {
  assert.equal(wallTime(new Date(Date.UTC(2026, 9, 1, 17, 43, 52, 214))), '2026-10-01 17:43:52');
  assert.equal(wallTime('2026. 10. 1 오후 5:43:52'), '2026-10-01 17:43:52');
  assert.equal(wallTime('2026. 10. 2 오전 12:05:00'), '2026-10-02 00:05:00');
});

test('sync: reads the raw tab (xlsx or Drive download JSON), excludes by timestamp prefix, fails closed on unmatched exclusions', async () => {
  const xlsx = await sheetXlsx([[new Date(Date.UTC(2026, 9, 1, 17, 43, 52)), payload(1)], [new Date(Date.UTC(2026, 9, 1, 18, 19, 49)), payload(2)], [new Date(Date.UTC(2026, 9, 2, 10, 34, 40)), payload(13)], [null, '']]);
  const xf = path.join(tmp, 'a.xlsx'), jf = path.join(tmp, 'a.json');
  fs.writeFileSync(xf, xlsx);
  fs.writeFileSync(jf, JSON.stringify({ title: 'T', content: xlsx.toString('base64') }));
  for (const f of [xf, jf]) {
    const rows = await readRawRows(await readXlsxBuffer(f));
    assert.deepEqual(rows.map((r) => r.ts), ['2026-10-01 17:43:52', '2026-10-01 18:19:49', '2026-10-02 10:34:40']);
    const b = buildBaked({ survey, rows, exclude: ['2026-10-01 17:43', '2026-10-01 18:19'] });
    assert.deepEqual(b.counts, { rows: 3, excluded: 2, included: 1 });
    const recs = parseGformCsv(b.csv, { surveyId: survey.surveyId });
    assert.equal(recs.length, 1);
    assert.equal(recs[0].answers.O01, 13);
    assert.equal(recs[0].answers.R01, '의견, "13"');
    assert.equal(recs[0].receivedAt, '2026-10-02T10:34:40+09:00');
    assert.throws(() => buildBaked({ survey, rows, exclude: ['2026-09-30 10:00'] }), /matched no row/);
  }
  await assert.rejects(readRawRows(xlsx, 'nope'), /tab not found/);
  assert.throws(() => buildBaked({ survey, rows: [{ ts: 'x', payload: 'not json' }] }));
});

test('build --baked: copies reports/baked/<id>.json, adds config.baked + surveys, refuses bad files and non-ignored in-repo dirs', async () => {
  const dir = path.join(tmp, 'baked'); fs.mkdirSync(dir);
  const b = buildBaked({ survey, rows: [{ ts: '2026-10-02 10:00:00', payload: payload(12) }] });
  fs.writeFileSync(path.join(dir, `${survey.surveyId}.json`), JSON.stringify(b));
  const out = path.join(tmp, 'site');
  const r = build(['--out', out, '--collector', 'https://c.example', '--survey-base', 'https://s.example/s/', '--surveys', 'sample-001', '--baked', dir]);
  assert.ok(r.files.includes(`reports/baked/${survey.surveyId}.json`));
  const cfg = JSON.parse(fs.readFileSync(path.join(out, 'reports/report-config.json'), 'utf8'));
  assert.deepEqual(cfg.baked, [survey.surveyId]);
  assert.deepEqual(cfg.surveys, ['sample-001', survey.surveyId]);
  assert.deepEqual(parseReportConfig(cfg).baked, [survey.surveyId]);
  assert.deepEqual(parseReportConfig({ baked: ['ok-1', 'Bad', 3] }).baked, ['ok-1']);
  // without --baked: no baked dir, no config key
  const out2 = path.join(tmp, 'site2');
  build(['--out', out2, '--collector', 'https://c.example', '--survey-base', 'https://s.example/s/']);
  assert.ok(!fs.existsSync(path.join(out2, 'reports/baked')));
  // bad baked files
  const bad = path.join(tmp, 'bad'); fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, 'other-001.json'), JSON.stringify(b));
  assert.throws(() => build(['--out', path.join(tmp, 's3'), '--collector', 'https://c.example', '--survey-base', 'https://s.example/s/', '--baked', bad]), /not a sf-baked-gform file/);
  assert.throws(() => build(['--out', path.join(tmp, 's4'), '--collector', 'https://c.example', '--survey-base', 'https://s.example/s/', '--baked', path.join(tmp, 'missing')]), /cannot read/);
  // secret-like content inside baked data still fails the scan
  const leak = path.join(tmp, 'leak'); fs.mkdirSync(leak);
  fs.writeFileSync(path.join(leak, `${survey.surveyId}.json`), JSON.stringify({ ...b, note: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }));
  assert.throws(() => build(['--out', path.join(tmp, 's5'), '--collector', 'https://c.example', '--survey-base', 'https://s.example/s/', '--baked', leak]), /provider token/);
  // in-repo dist/ is git-ignored: allowed
  const inRepo = path.join(root, 'dist', `test-baked-${process.pid}`);
  try { build(['--out', inRepo, '--collector', 'https://c.example', '--survey-base', 'https://s.example/s/', '--baked', dir]); } finally { fs.rmSync(inRepo, { recursive: true, force: true }); }
});
