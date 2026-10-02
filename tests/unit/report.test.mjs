import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { parseGformCsv, parseJsonl, parseCsv } from '../../lib/sources.mjs';
import { writeReport } from '../../tools/report.mjs';
import { distribute } from '../../tools/distribute.mjs';
import { SHEET_NAMES } from '../../lib/xlsx-rows.mjs';
import { containsForbidden } from '../../lib/kakao.mjs';
import { buildSheets } from '../../lib/xlsx-rows.mjs';
import { normalizeResponse } from '../../lib/normalize.mjs';
import { mini, fixture } from './helpers.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sflib-'));
const P = (ref, aff, answers, t) => JSON.stringify({ version: '1', ref, affiliation: aff, surveyType: 'C', answers, submittedAt: t });
const q = (s) => `"${s.replace(/"/g, '""')}"`;

const csv = [
  '타임스탬프,payload',
  `2026. 10. 2 오전 10:00:00,${q(P('G1-01', 'A사', { Q1: 12, Q2: 'NA', T1: '동선, "개선"\n필요', Q3: 9, C1: '현장' }, '2026-10-02T01:00:00Z'))}`,
  `2026. 10. 2 오전 11:00:00,${q(P('G1-01', 'A사', { Q1: 14, Q2: 'NA', T1: '수정본', Q3: 9, C1: '현장' }, '2026-10-02T02:00:00Z'))}`,
  `2026. 10. 2 오후 12:00:00,${q(P('', 'B사', { Q1: 8, Q2: 10, T1: '', Q3: 'NA', C1: '온라인' }, '2026-10-02T03:00:00Z'))}`,
].join('\r\n') + '\r\n';

test('gform-csv parsing of a synthetic Sheet export', () => {
  const recs = parseGformCsv('﻿' + csv, { surveyId: 'mini-001' });
  assert.equal(recs.length, 3);
  assert.equal(recs[0].answers.T1, '동선, "개선"\n필요');
  assert.equal(recs[0].receivedAt, '2026. 10. 2 오전 10:00:00');
  assert.equal(recs[2].ref, '미지정'); assert.equal(recs[2].category, 'B사');
  assert.equal(parseCsv('a,"b,c"\n1,2').length, 2);
  assert.throws(() => parseGformCsv('타임스탬프,이름\n1,2'));
});

test('jsonl: raw payloads and envelopes', () => {
  const env = JSON.stringify({ id: 'e1', surveyId: 's', receivedAt: 'r', raw: P('G1-02', 'B사', { Q1: 1 }, 't') });
  const recs = parseJsonl(`${P('G1-01', 'A사', { Q1: 2 }, 't')}\n\n${env}\n`);
  assert.deepEqual(recs.map((r) => [r.ref, r.id, r.receivedAt]), [['G1-01', 1, null], ['G1-02', 'e1', 'r']]);
});

test('xlsx re-read: sheets and cells; CLI end to end', async () => {
  const dir = tmp(), sv = mini();
  fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify(sv));
  fs.writeFileSync(path.join(dir, 'r.csv'), csv);
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', [new URL('../../tools/report.mjs', import.meta.url).pathname, path.join(dir, 's.json'), '--source', 'gform-csv', path.join(dir, 'r.csv'), '--out', path.join(dir, 'out')]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, 'out', 'mini-001-report.xlsx'));
  assert.deepEqual(wb.worksheets.map((w) => w.name), SHEET_NAMES);
  const get = (n) => wb.getWorksheet(n).getSheetValues().slice(1).map((r) => r.slice(1));
  const raw = get('raw'); assert.equal(raw.length, 4); assert.equal(raw[1][6], false); assert.equal(raw[2][6], true); // earlier dup flagged
  const responses = get('responses'); assert.equal(responses.length, 3); // dup removed
  assert.deepEqual(responses[0].slice(0, 4), ['ref', 'category', 'submittedAt', 'late']);
  assert.equal(responses[1][4], 14); // latest G1-01 Q1
  const summary = Object.fromEntries(get('summary').slice(1));
  assert.equal(summary.responses, 2); assert.equal(summary.duplicates_excluded, 1); assert.equal(summary.late, 0); // Sheet locale timestamps fall back to submittedAt (before deadline) assert.equal(summary['n:A사'], 1);
  const qs = get('questions'); const q1 = qs.find((r) => r[0] === 'Q1');
  assert.equal(q1[4], 11); assert.equal(q1[5], 1); assert.equal(q1[6], 2); // avg of 14 and 8, delta, valid
  const q3 = qs.find((r) => r[0] === 'Q3'); assert.equal(q3[7], 1); // NA count
  const tl = get('text_linked'); assert.equal(tl.length, 2); assert.equal(tl[1][5], '[A사 | 공연 14 · 수영장 평가안함]'); assert.equal(tl[1][6], '수정본');
  const rt = get('report_text').map((r) => r[0]); assert.equal(rt[0], 'text'); assert.equal(rt[1], '[설문 결과]');
  const txt = fs.readFileSync(path.join(dir, 'out', 'report.txt'), 'utf8');
  assert.ok(txt.startsWith('[설문 결과]\n응답수: 2'));
});

test('QR decode round-trip equals URL; kakao.txt and link.txt written', async () => {
  const dir = tmp(), sv = fixture('adora-ship-visit-001');
  const url = await distribute(sv, 'https://example.github.io/MD', dir);
  assert.equal(url, 'https://example.github.io/MD/surveys/adora-ship-visit-001/');
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, 'qr.png')));
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(res.data, url);
  assert.equal(fs.readFileSync(path.join(dir, 'link.txt'), 'utf8').trim(), url);
  const k = fs.readFileSync(path.join(dir, 'kakao.txt'), 'utf8');
  assert.ok(k.includes(url) && !containsForbidden(k));
  assert.ok(QRCode); // dependency present
});

test('late flag: raw/responses columns and summary counts (late counted vs duplicate)', () => {
  const sv = mini(); // deadline 2026-10-06T23:59:59+09:00
  const mk = (ref, answers, submittedAt, receivedAt, id) => normalizeResponse(P(ref, 'A사', answers, submittedAt), { id, receivedAt });
  const recs = [
    mk('G1-01', { Q1: 5 }, '2026-10-02T01:00:00Z', '2026-10-02T01:00:01Z', 1),        // dup (older), on time
    mk('G1-01', { Q1: 7 }, '2026-10-07T00:00:00Z', '2026-10-07T00:00:01Z', 2),        // late, counted
    mk('G1-02', { Q1: 9 }, '2026-10-02T00:00:00Z', '2026-10-07T01:00:00Z', 3),        // submitted early, received late -> late
    mk('G1-03', { Q1: 3 }, '2026-10-06T14:59:59Z', '2026-10-06T14:59:59Z', 4),        // exactly at deadline -> not late
  ];
  const { raw, responses, summary } = buildSheets(sv, recs);
  const rawLate = raw[0].indexOf('late'), respLate = responses[0].indexOf('late');
  assert.deepEqual(raw.slice(1).map((r) => r[rawLate]), [false, true, true, false]);
  assert.equal(responses[0][respLate], 'late');
  assert.deepEqual(responses.slice(1).map((r) => [r[0], r[respLate]]), [['G1-01', true], ['G1-02', true], ['G1-03', false]]);
  const sm = Object.fromEntries(summary.slice(1));
  assert.equal(sm.late, 2); assert.equal(sm.late_counted, 2); assert.equal(sm.responses, 3);
});
