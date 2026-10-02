// Deterministic memo -> draft survey.json scaffold (SPEC 15). Pure functions; the LLM refines the draft afterwards.
import { containsForbidden } from './kakao.mjs';

export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{3}$/;
export const THEMES = ['sage', 'soft-blue', 'warm-beige', 'lavender'];
const IDENTITY_RE = /성함|성명|이름|회사|소속|name|company/i;
const LABELS = { 행사: 'event', 행사일: 'eventDate', 대상: 'audience', 목적: 'purpose', 비교기준: 'baseline', 마감일: 'deadline', 참여구분: 'categories', 발신자: 'sender', 제목: 'title', 질문: 'questions' };

/** Parse labelled lines. Lines under `질문:` are bullets (`- text`) and section headings (`## 영역` or `[영역]`). */
export function parseMemo(text) {
  const out = { questions: [] };
  let inQ = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([가-힣]+)\s*[:：]\s*(.*)$/.exec(line);
    if (m && LABELS[m[1]]) {
      const key = LABELS[m[1]];
      if (key === 'questions') { inQ = true; if (m[2]) out.questions.push({ bullet: m[2] }); } else { inQ = false; out[key] = m[2].trim(); }
      continue;
    }
    if (!inQ) continue;
    const h = /^(?:#{1,3}\s*|\[)(.+?)\]?$/.exec(line);
    if (/^(#{1,3}\s|\[.+\]$)/.test(line) && h) out.questions.push({ heading: h[1].trim() });
    else out.questions.push({ bullet: line.replace(/^[-*•]\s*/, '') });
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
export function parseDeadline(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s))) {
    return { iso: s, date: s.slice(0, 10) };
  }
  const m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (Number.isNaN(Date.parse(`${y}-${pad(mo)}-${pad(d)}`)) || mo > 12) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  return { iso: `${date}T23:59:59+09:00`, date };
}
export const parseDate = (s) => { const r = parseDeadline(s); return r ? r.date : null; };

function parseBullet(b) {
  let text = b.trim(), kind = 'score', options, identity = false;
  const tag = /\s*\((주관식|text|식별허용|선택:[^)]*|복수:[^)]*)\)\s*$/;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    text = text.slice(0, m.index).trim();
    if (m[1] === '주관식' || m[1] === 'text') kind = 'text';
    else if (m[1] === '식별허용') identity = true;
    else { kind = m[1].startsWith('선택') ? 'singleChoice' : 'multiChoice'; options = m[1].split(':').slice(1).join(':').split('|').map((x) => x.trim()).filter(Boolean); }
  }
  return { text, kind, options, identity };
}

const todo = (what) => `TODO(${what})`;
const TODO_RE = /^TODO\(/;

/**
 * @returns {{survey: object, todos: string[], warnings: string[]}}
 */
export function scaffold(memo, { id, today } = {}) {
  const p = typeof memo === 'string' ? parseMemo(memo) : memo;
  const todos = [], warnings = [];
  const need = (v, what) => { if (v) return v; todos.push(what); return todo(what); };

  const event = need(p.event, '행사');
  const dl = parseDeadline(p.deadline);
  if (!dl) todos.push(p.deadline ? `마감일 형식 확인: ${p.deadline}` : '마감일');
  const evDate = parseDate(p.eventDate);
  if (!evDate) todos.push(p.eventDate ? `행사일 형식 확인: ${p.eventDate}` : '행사일');
  const hasBaseline = Boolean(p.baseline);
  const sender = p.sender || '';
  if (!p.sender) todos.push('발신자');

  const scale = hasBaseline
    ? { enabled: true, min: 0, max: 20, baseline: 10, baselineLabel: p.baseline, baselineName: p.baseline.split(/\s*=\s*/)[0].slice(0, 30), lowLabel: '0~9점: 기준보다 아쉬움', sameLabel: '10점: 기준과 비슷함', highLabel: '11~20점: 기준보다 우수함', allowNotEvaluated: true }
    : { enabled: true, min: 0, max: 10, baseline: 5, baselineLabel: '5점 = 보통', baselineName: '보통', lowLabel: '0~4점: 아쉬움', sameLabel: '5점: 보통', highLabel: '6~10점: 우수함', allowNotEvaluated: true };
  if (!hasBaseline) todos.push('비교기준 (없으면 0~10 중립척도가 적용됨, 확인 필요)');

  // sections
  const sections = [];
  let cur = null, n = 0;
  const privacyIds = [];
  const startSection = (title) => { cur = { id: `s${sections.length + 1}`, title, subtitle: '', theme: THEMES[sections.length % THEMES.length], questions: [] }; sections.push(cur); };
  for (const item of p.questions) {
    if (item.heading) { startSection(item.heading); continue; }
    const b = parseBullet(item.bullet);
    if (!b.text) continue;
    if (IDENTITY_RE.test(b.text) && !b.identity) {
      warnings.push(`식별 정보 질문 제외됨 (명시적 요청 필요: 문항 끝에 "(식별허용)" 표기): ${b.text}`);
      continue;
    }
    if (!cur) startSection(todo('영역 이름'));
    const qid = `Q${pad(++n)}`;
    const q = { id: qid, type: b.kind, prompt: b.text, required: b.kind !== 'text' };
    if (b.kind === 'text') { q.required = true; q.maxLength = 1000; }
    if (b.options) { if (!b.options.length) warnings.push(`선택지 없음: ${b.text}`); q.options = b.options; }
    if (b.identity) { q.identity = true; privacyIds.push(qid); }
    cur.questions.push(q);
  }
  if (!sections.length) { startSection(todo('영역 이름')); todos.push('질문'); }
  if (sections.some((s) => TODO_RE.test(s.title))) todos.push('영역 이름 (질문 앞에 "## 영역명" 행 필요)');

  // one linked text question per section that has scores and no text
  for (const s of sections) {
    const scores = s.questions.filter((q) => q.type === 'score');
    if (!scores.length) continue;
    const texts = s.questions.filter((q) => q.type === 'text');
    if (texts.length) {
      for (const t of texts) if (!t.linkedScores) t.linkedScores = scores.map((q) => q.id);
    } else {
      s.questions.push({ id: `Q${pad(++n)}`, type: 'text', prompt: '이 영역에 대한 의견을 자유롭게 적어주세요.', required: false, maxLength: 1000, linkedScores: scores.map((q) => q.id) });
    }
  }
  if (!sections.some((s) => s.questions.some((q) => q.type === 'score'))) warnings.push('점수형 질문이 없습니다.');

  const audience = (p.audience || '').split(/[,/·、]/).map((x) => x.trim()).filter(Boolean);
  const catList = p.categories ? p.categories.split(/[,/·、]/).map((x) => x.trim()).filter(Boolean) : audience;
  const options = catList.length ? catList : [todo('참여 구분')];
  if (!p.categories) todos.push('참여구분 (대상 값을 임시 사용함, 응답자가 고르는 소속/구분 범주로 정리)');

  const title = p.title || (event && `${event} 설문`);
  const survey = {
    surveyId: id ?? todo('surveyId'),
    version: `${(today ?? new Date().toISOString().slice(0, 10))}-v1`,
    title,
    eventName: event,
    eventDate: evDate ?? todo('행사일'),
    deadline: dl ? dl.iso : todo('마감일'),
    privacy: { allowIdentity: privacyIds.length > 0, identityQuestions: privacyIds },
    theme: 'default',
    intro: { brand: sender, eyebrow: evDate ?? '', paragraphs: [need(p.purpose, '목적')] },
    respondent: { label: '참여 구분을 선택해주세요.', help: '', options },
    scale,
    sections,
    page: { eyebrow: '', title, lead: p.purpose || todo('목적'), done: '소중한 의견 감사합니다.' },
    distribution: { deadlineText: dl ? `응답 마감: ${+dl.date.slice(0, 4)}년 ${+dl.date.slice(5, 7)}월 ${+dl.date.slice(8, 10)}일` : todo('마감일'), sender },
    collector: { adapter: 'local-mock', endpoint: 'http://127.0.0.1:18791/submit' },
    payload: { format: 'standard' },
  };
  if (containsForbidden(JSON.stringify(survey))) throw new Error('forbidden word in memo');
  return { survey, todos, warnings };
}

export const INTAKE_RULES = [
  '질문의 질이 우선입니다. 전문가 대상 설문에 일반 소비자 만족도 문항을 쓰지 않습니다.',
  '개선 요청이 목적이면 질문의 70~80% 이상을 현 상태 / 강점 / 약점 / 개선사항에 둡니다.',
  '메모에 없는 사실(이름, 날짜, 수치, 회사, 장소)은 만들지 않습니다. 모르면 TODO로 남기고 보고합니다.',
  '이름·회사명 질문은 메모가 명시적으로 요청한 경우에만 만들고, 그때는 해당 질문 id만 privacy.identityQuestions에 넣습니다 (allowIdentity: true).',
  '참여 구분은 필요 최소 범주로만 받습니다.',
  '직접 경험하지 못한 항목을 위해 scale.allowNotEvaluated: true 를 유지합니다. 평가안함은 평균에서 제외됩니다.',
  '각 영역의 점수형 질문에는 같은 영역의 주관식을 linkedScores 로 연결합니다.',
  '금지어(U+C775 U+BA85 두 코드포인트로 이루어진 한국어 단어)는 survey.json 어디에도, 배포문에도 쓰지 않습니다. 글자를 직접 쓰지 말고 코드포인트로 검사합니다.',
  'surveyId 는 kebab-case + -NNN (예: ship-visit-002). 기존 surveys/ 의 id 를 재사용하지 않습니다.',
  'deadline 은 오프셋이 있는 ISO 형식 (예: 2026-10-06T23:59:59+09:00) 입니다.',
  '기존 surveys/<id>/ 폴더를 수정하거나 덮어쓰지 않습니다. 새 폴더만 만듭니다.',
  '최종 산출물은 schema/survey.schema.json 과 tools/validate.mjs 를 통과해야 합니다.',
];

export function buildIntakePrompt({ memo, draft, todos = [], warnings = [], existingIds = [], outPath = 'surveys/<id>/survey.json' }) {
  return `# 설문 콘텐츠 작성 요청 (Survey Factory intake)

당신은 전문가 설문 콘텐츠 작성자입니다. 아래 메모와 초안(draft)을 바탕으로 \`${outPath}\` 를 완성하세요.
엔진·HTML·JS 는 수정하지 않습니다. survey.json 만 만듭니다.

## 규칙
${INTAKE_RULES.map((r) => `- ${r}`).join('\n')}

## 작업 순서
1. 메모에서 목적, 대상, 비교기준, 마감일을 확인하고 TODO 항목을 정리합니다 (메모에 답이 없으면 임의로 채우지 말고 최종 보고에 남깁니다).
2. 질문안을 영역별로 다듬습니다 (질문 문구, help, shortLabel). 점수형 질문에는 linked 줄에 쓰일 짧은 shortLabel 을 붙입니다.
3. 초안 JSON 을 수정해 \`${outPath}\` 에 저장합니다.
4. \`node tools/validate.mjs ${outPath}\` 를 실행해 통과할 때까지 고칩니다.
5. 최종 보고: 변경 요약, 남은 TODO, 메모에 없어서 비워 둔 항목.

## 기존 surveyId (재사용 금지)
${existingIds.length ? existingIds.map((i) => `- ${i}`).join('\n') : '- (없음)'}

## 자동 점검 결과
${todos.length ? todos.map((t) => `- TODO: ${t}`).join('\n') : '- TODO 없음'}
${warnings.map((w) => `- 경고: ${w}`).join('\n')}

## 메모 원문
\`\`\`
${memo.trim()}
\`\`\`

## 초안 (draft survey.json)
\`\`\`json
${JSON.stringify(draft, null, 2)}
\`\`\`
`;
}
