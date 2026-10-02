import { normalizeResponse } from './normalize.mjs';

/** RFC4180-ish CSV parser (quotes, doubled quotes, embedded newlines, BOM). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/** Google Form response sheet export: columns 타임스탬프 and payload (long-text field). */
export function parseGformCsv(text, { surveyId } = {}) {
  const [header = [], ...rows] = parseCsv(text);
  const ts = header.findIndex((h) => h.trim() === '타임스탬프' || /^timestamp$/i.test(h.trim()));
  let pi = header.findIndex((h) => /payload/i.test(h));
  if (pi < 0) pi = header.findIndex((h, i) => i !== ts && rows.some((r) => (r[i] ?? '').trim().startsWith('{')));
  if (pi < 0) throw new Error('payload column not found');
  return rows.filter((r) => (r[pi] ?? '').trim() !== '')
    .map((r, i) => normalizeResponse(r[pi], { id: `row-${i + 2}`, surveyId, receivedAt: ts >= 0 ? r[ts] : null }));
}

/** JSONL: each line is a raw payload or a collector envelope {id, surveyId, receivedAt, raw}. */
export function parseJsonl(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line, i) => {
    const o = JSON.parse(line);
    if (o && o.raw !== undefined && !('answers' in o)) return normalizeResponse(o.raw, { id: o.id ?? i + 1, surveyId: o.surveyId, receivedAt: o.receivedAt });
    return normalizeResponse(line, { id: i + 1 });
  });
}
