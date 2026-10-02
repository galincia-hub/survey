#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseGformCsv, parseJsonl } from '../lib/sources.mjs';
import { dedupeLatest } from '../lib/normalize.mjs';
import { buildSheets } from '../lib/xlsx-rows.mjs';
import { buildCopyText } from '../lib/copytext.mjs';

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
  if (!surveyPath || !['jsonl', 'gform-csv'].includes(source) || !file || !out) {
    console.error('usage: report.mjs <surveyJsonPath> --source jsonl|gform-csv <file> --out <dir>');
    process.exit(2);
  }
  const survey = JSON.parse(fs.readFileSync(surveyPath, 'utf8'));
  const text = fs.readFileSync(file, 'utf8');
  const records = source === 'jsonl' ? parseJsonl(text) : parseGformCsv(text, { surveyId: survey.surveyId });
  const r = await writeReport(survey, records, out);
  console.log(`wrote ${r.xlsx}\nwrote ${r.txt}`);
}
