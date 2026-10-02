export const fmt1 = (n) => (n === null || n === undefined ? '-' : n.toFixed(1));
export const fmtDelta = (n) => (n === null || n === undefined ? '-' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}`);
export const label = (q) => q.shortLabel || q.prompt;

export function scoreToken(v) {
  if (v === 'NA') return '평가안함';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return String(Number(v));
  return '-';
}

/** `[{category} | {shortLabel} {score} · {shortLabel} 평가안함 · ...]` */
export function linkedPrefix(survey, q, record) {
  const byId = new Map(survey.sections.flatMap((s) => s.questions).map((x) => [x.id, x]));
  const parts = (q.linkedScores ?? []).filter((id) => byId.has(id))
    .map((id) => `${label(byId.get(id))} ${scoreToken(record.answers[id])}`);
  return `[${[record.category, parts.length ? parts.join(' · ') : null].filter((x) => x !== null).join(' | ')}]`;
}
