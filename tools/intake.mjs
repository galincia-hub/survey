#!/usr/bin/env node
// node tools/intake.mjs <memo.txt> --id <surveyId> [--out surveys/<id>/survey.json] [--surveys-dir surveys]
import fs from 'node:fs';
import path from 'node:path';
import { scaffold, buildIntakePrompt, ID_RE } from '../lib/intake.mjs';
import { containsForbidden } from '../lib/kakao.mjs';

export function intake({ memoPath, id, out, surveysDir = 'surveys', today }) {
  if (!ID_RE.test(id ?? '')) throw new Error(`surveyId must be kebab-case ending in -NNN (e.g. ship-visit-002): ${id}`);
  out = out ?? path.join(surveysDir, id, 'survey.json');
  const dir = path.dirname(out);
  const existingIds = fs.existsSync(surveysDir) ? fs.readdirSync(surveysDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  if (existingIds.includes(id) || fs.existsSync(dir) || fs.existsSync(out)) throw new Error(`refusing to overwrite existing survey dir: ${dir}`);
  const memo = fs.readFileSync(memoPath, 'utf8');
  if (containsForbidden(memo)) throw new Error('memo contains the forbidden word; remove it and retry');
  const { survey, todos, warnings } = scaffold(memo, { id, today });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(survey, null, 2) + '\n', { flag: 'wx' });
  const promptPath = `${out}.prompt.md`;
  fs.writeFileSync(promptPath, buildIntakePrompt({ memo, draft: survey, todos, warnings, existingIds, outPath: out }), { flag: 'wx' });
  return { out, promptPath, todos, warnings, survey };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
  if (!a[0] || a[0].startsWith('--') || !opt('--id')) { console.error('usage: intake.mjs <memo.txt> --id <surveyId> [--out <path>] [--surveys-dir <dir>]'); process.exit(2); }
  try {
    const r = intake({ memoPath: a[0], id: opt('--id'), out: opt('--out'), surveysDir: opt('--surveys-dir') });
    console.log(`wrote ${r.out}\nwrote ${r.promptPath}`);
    for (const t of r.todos) console.log(`TODO: ${t}`);
    for (const w of r.warnings) console.log(`WARN: ${w}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
