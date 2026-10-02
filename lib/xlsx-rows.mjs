import { computeStats, scoreQuestions } from './stats.mjs';
import { dedupeLatest, markLate } from './normalize.mjs';
import { buildCopyText } from './copytext.mjs';
import { linkedPrefix } from './format.mjs';

export const SHEET_NAMES = ['raw', 'responses', 'summary', 'questions', 'text_linked', 'report_text'];

const cell = (v) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : v);

/** Pure: returns {sheetName: array-of-rows (first row = header)}. Full precision numbers. */
export function buildSheets(survey, allRecords) {
  markLate(allRecords, survey.deadline);
  const { records, duplicates } = dedupeLatest(allRecords);
  const stats = computeStats(survey, records);
  const counted = new Set(records);
  const qs = survey.sections.flatMap((s) => s.questions.map((q) => ({ s, q })));

  const raw = [['id', 'surveyId', 'ref', 'category', 'submittedAt', 'receivedAt', 'counted', 'late', 'raw'],
    ...allRecords.map((r) => [cell(r.id), cell(r.surveyId), r.ref, r.category, cell(r.submittedAt), cell(r.receivedAt), counted.has(r), r.late, r.raw])];

  const responses = [['ref', 'category', 'submittedAt', 'late', ...qs.map(({ q }) => q.id)],
    ...records.map((r) => [r.ref, r.category, cell(r.submittedAt), r.late, ...qs.map(({ q }) => cell(r.answers[q.id]))])];

  const summary = [['item', 'value'], ['responses', stats.n], ['duplicates_excluded', duplicates.length],
    ['late', allRecords.filter((r) => r.late).length], ['late_counted', records.filter((r) => r.late).length]];
  for (const c of stats.categories) summary.push([`n:${c}`, stats.nByCategory[c]]);
  for (const a of Object.values(stats.areas)) summary.push([`area:${a.title}`, a.avg ?? '']);
  summary.push(['overall', stats.overall.avg ?? ''], ['overall_valid', stats.overall.valid]);

  const questions = [['id', 'section', 'prompt', 'baseline', 'avg', 'delta', 'valid', 'na', 'unanswered', 'min', 'max',
    ...stats.categories.map((c) => `avg:${c}`)]];
  for (const { section, q } of scoreQuestions(survey)) {
    const st = stats.questions[q.id];
    questions.push([q.id, section.title, q.prompt, cell(st.baseline), cell(st.avg), cell(st.delta), st.valid, st.na, st.unanswered,
      cell(st.min), cell(st.max), ...stats.categories.map((c) => cell(st.byCategory[c].avg))]);
  }

  const text_linked = [['id', 'section', 'prompt', 'ref', 'category', 'linked', 'text']];
  for (const { s, q } of qs) {
    if (q.type !== 'text') continue;
    for (const r of records) {
      const t = r.answers[q.id];
      if (typeof t === 'string' && t.trim()) text_linked.push([q.id, s.title, q.prompt, r.ref, r.category, linkedPrefix(survey, q, r), t.trim()]);
    }
  }

  const report_text = [['text'], ...buildCopyText(survey, records, 'all', stats).split('\n').map((l) => [l])];
  return { raw, responses, summary, questions, text_linked, report_text };
}
