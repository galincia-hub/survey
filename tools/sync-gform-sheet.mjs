#!/usr/bin/env node
// Google Form response Sheet (exported .xlsx) -> baked report data for the private report host.
//   node tools/sync-gform-sheet.mjs --survey <surveyId|survey.json> --in <file.xlsx | drive-download.json> --out <file.json>
//        [--tab <raw tab name>] [--tz +09:00] [--exclude-ts "YYYY-MM-DD HH:MM[:SS]"]...
// --in accepts either the .xlsx itself or the JSON written by the Google Drive connector's download_file_content
// ({ title, mimeType, content: <base64 xlsx> }). Rows whose sheet timestamp starts with an --exclude-ts value are dropped
// (e.g. test submissions); every --exclude-ts must match at least one row, otherwise the run fails (fail closed).
// The output holds survey.json + a gform-csv (타임스탬프,payload) and is personal data: write it OUTSIDE the repository
// (or to a git-ignored path) and only upload it inside the access-protected report bundle. Nothing is printed except counts.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseGformCsv } from '../lib/sources.mjs';

export const BAKED_KIND = 'sf-baked-gform';

const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const pad = (n) => String(n).padStart(2, '0');

/** Sheet cell -> "YYYY-MM-DD HH:MM:SS" in the sheet's wall-clock time. Excel serial dates come back as UTC-labelled wall time. */
export function wallTime(v) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  const s = String(v ?? '').trim();
  const m = /^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?\s+(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return s;
  let h = Number(m[5]);
  if (m[4] === '오후' && h < 12) h += 12;
  if (m[4] === '오전' && h === 12) h = 0;
  return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(h)}:${m[6]}:${m[7] ?? '00'}`;
}

export async function readXlsxBuffer(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0x50 && buf[1] === 0x4b) return buf; // PK zip = xlsx
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('--in must be an .xlsx or the Drive connector download JSON'); }
  const b64 = j.content ?? j.base64Content;
  if (typeof b64 !== 'string') throw new Error('download JSON has no base64 "content"');
  return Buffer.from(b64, 'base64');
}

/** Rows of the raw response tab: [{ ts: wall time string, payload: string }]. */
export async function readRawRows(buffer, tab) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = tab ? wb.getWorksheet(tab) : wb.worksheets.find((w) => /payload/i.test(String(w.getRow(1).values.join('|'))));
  if (!ws) throw new Error(tab ? `tab not found: ${tab}` : 'no tab with a "payload" header found');
  const head = ws.getRow(1).values.map((v) => String(v ?? '').trim());
  const ti = head.findIndex((h) => h === '타임스탬프' || /^timestamp$/i.test(h));
  const pi = head.findIndex((h) => /payload/i.test(h));
  if (ti < 0 || pi < 0) throw new Error('raw tab needs 타임스탬프/Timestamp and payload columns');
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const cell = (i) => { const v = row.getCell(i).value; return v && typeof v === 'object' && !(v instanceof Date) ? (v.text ?? v.result ?? '') : v; };
    const payload = String(cell(pi) ?? '').trim();
    if (payload) rows.push({ ts: wallTime(cell(ti)), payload });
  });
  return rows;
}

export function buildBaked({ survey, rows, exclude = [], tz = '+09:00', sourceTitle = null, tab = null, now = new Date() }) {
  if (!/^[+-]\d{2}:\d{2}$/.test(tz)) throw new Error('--tz must look like +09:00');
  const hits = new Map(exclude.map((e) => [e, 0]));
  const kept = rows.filter((r) => {
    const ex = exclude.find((e) => r.ts.startsWith(e));
    if (ex) { hits.set(ex, hits.get(ex) + 1); return false; }
    return true;
  });
  const unmatched = [...hits].filter(([, n]) => n === 0).map(([e]) => e);
  if (unmatched.length) throw new Error(`--exclude-ts matched no row: ${unmatched.join(', ')}`);
  const iso = (ts) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) ? `${ts.replace(' ', 'T')}${tz}` : ts);
  const csv = ['타임스탬프,payload', ...kept.map((r) => `${csvCell(iso(r.ts))},${csvCell(r.payload)}`)].join('\n') + '\n';
  const parsed = parseGformCsv(csv, { surveyId: survey.surveyId }); // validates every payload is JSON
  return {
    kind: BAKED_KIND, version: 1, surveyId: survey.surveyId, generatedAt: now.toISOString(),
    source: { type: 'gform-sheet', title: sourceTitle, tab },
    counts: { rows: rows.length, excluded: rows.length - kept.length, included: parsed.length },
    survey, csv,
  };
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const args = process.argv.slice(2);
  const o = { exclude: [] };
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i], v = args[i + 1];
    if (v === undefined) { console.error(`missing value for ${k}`); process.exit(2); }
    if (k === '--exclude-ts') o.exclude.push(v.trim());
    else if (['--survey', '--in', '--out', '--tab', '--tz'].includes(k)) o[k.slice(2)] = v;
    else { console.error(`unknown argument: ${k}`); process.exit(2); }
  }
  if (!o.survey || !o.in || !o.out) { console.error('usage: sync-gform-sheet.mjs --survey <id|survey.json> --in <xlsx|download.json> --out <file.json> [--tab name] [--tz +09:00] [--exclude-ts "YYYY-MM-DD HH:MM"]...'); process.exit(2); }
  try {
    const surveyPath = o.survey.endsWith('.json') ? o.survey : path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'surveys', o.survey, 'survey.json');
    const survey = JSON.parse(fs.readFileSync(surveyPath, 'utf8'));
    let title = null;
    try { title = JSON.parse(fs.readFileSync(o.in, 'utf8')).title ?? null; } catch { /* plain xlsx */ }
    const rows = await readRawRows(await readXlsxBuffer(o.in), o.tab);
    const baked = buildBaked({ survey, rows, exclude: o.exclude, tz: o.tz ?? '+09:00', sourceTitle: title, tab: o.tab ?? null });
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, JSON.stringify(baked) + '\n', { mode: 0o600 });
    console.log(`${baked.surveyId}: sheet rows ${baked.counts.rows}, excluded ${baked.counts.excluded}, included ${baked.counts.included} -> ${o.out}`);
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
