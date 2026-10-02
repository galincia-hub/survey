// Normalize legacy Adora payloads and standard (SPEC 8) payloads into one record shape.
export const DEFAULT_REF = '미지정';

function parseRaw(raw) {
  if (typeof raw === 'string') return JSON.parse(raw);
  if (raw && typeof raw === 'object') return raw;
  throw new Error('payload must be an object or JSON string');
}

/**
 * @param raw payload object or JSON string
 * @param meta optional { id, surveyId, receivedAt } (collector envelope / sheet row)
 */
export function normalizeResponse(raw, meta = {}) {
  const p = parseRaw(raw);
  const answers = p.answers && typeof p.answers === 'object' ? p.answers : {};
  const ref = String(p.ref ?? '').trim();
  return {
    id: meta.id ?? null,
    surveyId: p.surveyId ?? meta.surveyId ?? null,
    version: p.version ?? null,
    ref: ref === '' ? DEFAULT_REF : ref,
    category: String(p.respondentCategory ?? p.affiliation ?? ''),
    answers,
    submittedAt: p.submittedAt ?? null,
    receivedAt: meta.receivedAt ?? p.receivedAt ?? null,
    format: 'respondentCategory' in p ? 'standard' : 'legacy',
    raw: typeof raw === 'string' ? raw : JSON.stringify(raw),
  };
}

function time(r, i) {
  const t = Date.parse(r.submittedAt ?? '');
  return Number.isNaN(t) ? null : t;
}

/**
 * Raw is always kept by the caller. Views count the latest record per non-default ref;
 * records without a ref ("미지정") are never deduped.
 * @returns {{records: object[], duplicates: object[]}} records keep input order
 */
export function dedupeLatest(records) {
  const winner = new Map();
  records.forEach((r, i) => {
    if (r.ref === DEFAULT_REF) return;
    const prev = winner.get(r.ref);
    if (prev === undefined) return winner.set(r.ref, i);
    const a = time(records[prev]), b = time(r);
    // later submittedAt wins; ties / unparsable fall back to input order (later wins)
    if (a === null || b === null || b >= a) winner.set(r.ref, i);
  });
  const kept = [], duplicates = [];
  records.forEach((r, i) => {
    if (r.ref === DEFAULT_REF || winner.get(r.ref) === i) kept.push(r);
    else duplicates.push(r);
  });
  return { records: kept, duplicates };
}
