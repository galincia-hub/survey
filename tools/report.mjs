#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseGformCsv, parseJsonl } from '../lib/sources.mjs';
import { normalizeResponse } from '../lib/normalize.mjs';
import { dedupeLatest } from '../lib/normalize.mjs';
import { buildSheets } from '../lib/xlsx-rows.mjs';
import { buildCopyText } from '../lib/copytext.mjs';

/** GET /v1/responses/:id from a Worker collector. The secret is only sent as a Bearer header and never appears in output or errors. */
export async function fetchWorkerRecords(endpoint, surveyId, secret, fetchImpl = fetch) {
  const u = new URL(endpoint);
  const loopback = u.hostname === 'localhost' || u.hostname === '[::1]' || /^127\./.test(u.hostname);
  if (u.username || u.password || u.search || u.hash || !(u.protocol === 'https:' || (u.protocol === 'http:' && loopback))) throw new Error('worker endpoint must be https (or loopback http) without credentials/query');
  if (!secret) throw new Error('REPORT_SECRET environment variable is required for --source worker');
  const res = await fetchImpl(`${u.href.replace(/\/$/, '')}/v1/responses/${encodeURIComponent(surveyId)}`, { headers: { Authorization: `Bearer ${secret}` }, redirect: 'error' });
  if (res.status === 401) throw new Error('collector rejected REPORT_SECRET (HTTP 401)');
  if (!res.ok) throw new Error(`collector returned HTTP ${res.status}`);
  const body = await res.json();
  return body.responses.map((e) => normalizeResponse(e.raw, { id: e.id, surveyId: e.surveyId, receivedAt: e.receivedAt }));
}

export async function writeReport(survey, records, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(buildSheets(survey, records))) {
    const ws = wb.addWorksheet(name);
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true };
  }
  const xlsx = path.join(outDir, `${survey.surveyId}-report.xlsx`);
  await wb.xlsx.writeFile(xlsx);
  const txt = path.join(outDir, 'report.txt');
  fs.writeFileSync(txt, buildCopyText(survey, dedupeLatest(records).records, 'all'));
  return { xlsx, txt };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
  const surveyPath = args[0], source = opt('--source'), file = args[args.indexOf('--source') + 2], out = opt('--out');
  if (!surveyPath || !['jsonl', 'gform-csv', 'worker'].includes(source) || !file) {
    console.error('usage: report.mjs <surveyId|surveyJsonPath> --source jsonl|gform-csv <file> [--out <dir>]\n       REPORT_SECRET=... report.mjs <surveyId|surveyJsonPath> --source worker <endpoint> [--out <dir>]');
    process.exit(2);
  }
  try {
    const survey = JSON.parse(fs.readFileSync(surveyPath.endsWith('.json')?surveyPath:path.join('surveys',surveyPath,'survey.json'), 'utf8'));
    const records = source === 'worker' ? await fetchWorkerRecords(file, survey.surveyId, process.env.REPORT_SECRET)
      : source === 'jsonl' ? parseJsonl(fs.readFileSync(file, 'utf8')) : parseGformCsv(fs.readFileSync(file, 'utf8'), { surveyId: survey.surveyId });
    const r = await writeReport(survey, records.filter(r=>!r.surveyId||r.surveyId===survey.surveyId), out||path.join('dist',survey.surveyId,'reports'));
    console.log(`wrote ${r.xlsx}\nwrote ${r.txt}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
