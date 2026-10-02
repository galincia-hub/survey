import { computeStats } from './stats.mjs';
import { fmt1, fmtDelta, linkedPrefix } from './format.mjs';

export const MODES = ['all', 'scores', 'text'];

const oneLine = (t) => String(t).trim();

function evaluationBasis(survey) {
  const s = survey.scale;
  if (!s?.enabled) return '-';
  return `${s.baselineLabel || `기준 ${s.baseline}점`} (${s.min}~${s.max}점)`;
}

/** SPEC 11 plain text, survey order. mode: all | scores | text */
export function buildCopyText(survey, records, mode = 'all', stats = computeStats(survey, records)) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode}`);
  const out = ['[설문 결과]', `응답수: ${stats.n}`, `평가기준: ${evaluationBasis(survey)}`];
  for (const s of survey.sections) {
    const block = [];
    for (const q of s.questions) {
      if (q.type === 'score' && mode !== 'text') {
        const st = stats.questions[q.id];
        block.push(`■ ${q.prompt}`, `평균: ${fmt1(st.avg)}`, `기준대비: ${fmtDelta(st.delta)}`,
          `유효응답: ${st.valid}`, `평가 어려움: ${st.na}`);
      } else if (q.type === 'text' && mode !== 'scores') {
        const lines = records.filter((r) => typeof r.answers[q.id] === 'string' && r.answers[q.id].trim() !== '')
          .map((r) => `${linkedPrefix(survey, q, r)} ${oneLine(r.answers[q.id])}`);
        block.push(`■ ${q.prompt}`, '[관련 주관식]', ...(lines.length ? lines : ['(응답 없음)']));
      } else if ((q.type === 'singleChoice' || q.type === 'multiChoice') && mode === 'all') {
        const counts = (q.options ?? []).map((o) => {
          const n = records.filter((r) => [].concat(r.answers[q.id] ?? []).includes(o)).length;
          return `${o} ${n}`;
        });
        block.push(`■ ${q.prompt}`, `선택: ${counts.join(' · ')}`);
      }
    }
    if (block.length) out.push('', `[${s.title}]`, ...block);
  }
  if (mode !== 'text' && stats.categories.length) {
    out.push('', '[참여 구분별 평균]');
    for (const c of stats.categories) {
      const parts = Object.values(stats.areas).map((a) => `${a.title} ${fmt1(a.byCategory[c])}`);
      parts.push(`종합 ${fmt1(stats.overallByCategory[c])}`);
      out.push(`${c} (n=${stats.nByCategory[c]}): ${parts.join(' · ')}`);
    }
    out.push('', `종합 평균: ${fmt1(stats.overall.avg)} (유효 ${stats.overall.valid})`);
  }
  return out.join('\n') + '\n';
}
