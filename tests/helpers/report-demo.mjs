// Synthetic, deterministic demo data for report tests and screenshots. No real responses.
import fs from 'node:fs';
import { normalizeResponse } from '../../lib/normalize.mjs';

const base = JSON.parse(fs.readFileSync(new URL('../fixtures/surveys/adora-ship-visit-001.json', import.meta.url), 'utf8'));

/** Adora fixture + one extra section with a single- and a multi-choice question (no theme -> cycle), 6 categories of which 3 get responses. */
export function demoSurvey() {
  const s = structuredClone(base);
  s.surveyId = 'demo-001';
  s.title = '샘플 크루즈 방선투어 전문가 평가';
  s.eventName = 'DEMO 방선투어 (가상 데이터)';
  s.collector = { adapter: 'local-mock', endpoint: 'http://127.0.0.1:18791/submit' };
  s.sections.push({ id: 'extra', title: '운영 방식', subtitle: '선택형 문항 예시', questions: [
    { id: 'X01', type: 'singleChoice', prompt: '다음 방선에서 선호하는 일정은?', required: false, options: ['당일', '1박 2일', '2박 3일'] },
    { id: 'X02', type: 'multiChoice', prompt: '추가로 확인하고 싶은 시설을 모두 골라주세요.', required: false, options: ['객실', '스파', '키즈클럽', '엔터테인먼트'] },
  ] });
  return s;
}

const COMMENTS = ['공연장 동선이 좁아 혼잡할 것 같습니다.', '바 라운지 분위기가 좋았습니다.\n다만 메뉴가 단조로웠습니다.', '객실 컨디션은 기대 이상이었습니다.',
  '<img src=x onerror=alert(1)> 태그가 그대로 보여야 합니다 & "인용"', '한국 시장 대응 인력이 더 필요합니다.', '수영장 관리 상태가 아쉬웠습니다.'];

export function demoPayloads(survey = demoSurvey(), n = 24) {
  let seed = 7;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const cats = survey.respondent.options.slice(0, 3);
  const qs = survey.sections.flatMap((s) => s.questions);
  const payloads = [];
  for (let i = 0; i < n; i++) {
    const cat = cats[i % 3];
    const bias = i % 3 === 0 ? 3 : i % 3 === 1 ? -2 : 0;
    const answers = {};
    for (const q of qs) {
      if (q.type === 'score') answers[q.id] = rnd() < 0.08 ? 'NA' : Math.max(0, Math.min(20, Math.round(10 + bias + (rnd() - 0.4) * 9)));
      else if (q.type === 'text') answers[q.id] = rnd() < 0.55 ? COMMENTS[Math.floor(rnd() * COMMENTS.length)] : '';
      else if (q.type === 'singleChoice') answers[q.id] = rnd() < 0.9 ? q.options[Math.floor(rnd() * q.options.length)] : '';
      else answers[q.id] = q.options.filter(() => rnd() < 0.45);
    }
    const day = String(1 + Math.floor(i / 8)).padStart(2, '0');
    const ref = i === 5 ? 'G1-01' : i === 6 ? 'G1-01' : `G${1 + (i % 3)}-${String(i).padStart(2, '0')}`; // 5 and 6 share a ref (duplicate)
    payloads.push(JSON.stringify({ version: survey.version, ref, affiliation: cat, surveyType: 'C', answers, submittedAt: `2026-10-${day}T0${i % 10}:${String(10 + i).padStart(2, '0')}:00.000Z` }));
  }
  return payloads;
}

export const demoRecords = (survey = demoSurvey()) => demoPayloads(survey).map((p, i) => normalizeResponse(p, { id: i + 1, surveyId: survey.surveyId, receivedAt: JSON.parse(p).submittedAt }));
