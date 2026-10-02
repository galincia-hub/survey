import { computeStats } from './stats.mjs';
import { fmt1, fmtDelta } from './format.mjs';

/** SPEC 12: AI report prompt built from survey.json (+ stats). Contains no survey-specific text of its own. */
export function buildAiPrompt(survey, records, stats = computeStats(survey, records)) {
  const sc = survey.scale ?? {};
  const purpose = survey.distribution?.purpose || survey.page?.lead || '';
  const L = [];
  L.push('당신은 설문 결과를 분석해 보고서를 작성하는 전문 애널리스트입니다. 아래 설문 정보와 결과를 바탕으로 보고서를 작성해 주세요.', '');
  L.push('[설문 개요]', `설문명: ${survey.title}`, `행사명: ${survey.eventName}`, `행사일: ${survey.eventDate}`);
  if (purpose) L.push(`설문 목적: ${purpose}`);
  if (sc.enabled) L.push(`평가척도: ${sc.min}~${sc.max}점, 기준 ${sc.baseline}점${sc.baselineLabel ? ` (${sc.baselineLabel})` : ''}`);
  L.push(`응답수: ${stats.n}`);
  L.push(`참여 구분: ${stats.categories.map((c) => `${c} ${stats.nByCategory[c]}명`).join(', ')}`, '');
  L.push('[영역 구성]');
  survey.sections.forEach((s, i) => {
    const a = stats.areas[s.id];
    L.push(`${i + 1}. ${s.title}${s.subtitle ? ` - ${s.subtitle}` : ''}${a ? ` (영역 평균 ${fmt1(a.avg)}, 기준대비 ${fmtDelta(a.avg === null ? null : a.avg - sc.baseline)})` : ''}`);
    for (const q of s.questions) {
      const st = stats.questions[q.id];
      L.push(st ? `   - ${q.prompt}: 평균 ${fmt1(st.avg)}, 유효 ${st.valid}, 평가 어려움 ${st.na}` : `   - ${q.prompt} (${q.type === 'text' ? '주관식' : '선택형'})`);
    }
  });
  L.push('', `종합 평균: ${fmt1(stats.overall.avg)}`, '', '[보고서 구조 요청]');
  const sections = survey.sections.map((s) => s.title).join(' / ');
  L.push('1. 요약 (핵심 결론 3줄 이내)', `2. 영역별 분석 (${sections})`, '3. 강점', '4. 약점', '5. 반복적으로 나타나는 의견', '6. 개선 우선순위 (근거와 함께)', '7. 참여 구분별 의견 차이', '');
  L.push('[작성 원칙]',
    '- 수치(점수 통계)와 주관식 원문을 구분해서 서술합니다.',
    '- 주관식에서 반복되는 의견을 찾아 묶고, 원문을 근거로 인용합니다.',
    '- "평가하기 어려움(NA)"은 평균에 포함하지 않으며 0점으로 계산하지 않습니다. 유효응답 수와 평가 어려움 수를 함께 언급합니다.',
    '- 주관식은 함께 제공되는 관련 점수와 연결해서 해석합니다.',
    '- 설문에 없는 사실은 추측하지 않습니다. 근거가 부족하면 부족하다고 밝힙니다.',
    '', '[결과 데이터]', '아래에 "보고서용 복사" 결과를 붙여넣어 주세요.', '');
  return L.join('\n');
}
