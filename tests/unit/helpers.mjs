import fs from 'node:fs';
import { normalizeResponse } from '../../lib/normalize.mjs';

export const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/surveys/${name}.json`, import.meta.url), 'utf8'));

// Small synthetic survey: 2 areas, shortLabels, a linked text question.
export const mini = () => ({
  surveyId: 'mini-001', version: '1', title: '미니 설문', eventName: '미니 행사', eventDate: '2026-10-01',
  deadline: '2026-10-06T23:59:59+09:00',
  respondent: { label: '구분', help: '', options: ['A사', 'B사'] },
  scale: { enabled: true, min: 0, max: 20, baseline: 10, baselineLabel: '기준 = 10점', baselineName: '기준', lowLabel: '', sameLabel: '', highLabel: '', allowNotEvaluated: true },
  page: { eyebrow: '', title: '평가', lead: '목적 문장', done: '' },
  distribution: { deadlineText: '응답 마감: 2026년 10월 6일', sender: '발신자X', greeting: '안녕하세요.', thanks: '감사합니다.', purpose: '목적입니다.', whyYou: '의견이 중요합니다.', usage: '개선에 활용합니다.', ask: '참여 부탁드립니다.', ripple: '주변에도 알려주세요.' },
  sections: [
    { id: 'a', title: '영역A', subtitle: '', theme: 'sage', questions: [
      { id: 'Q1', type: 'score', prompt: '공연 관련 시설', shortLabel: '공연', required: true },
      { id: 'Q2', type: 'score', prompt: '수영장', shortLabel: '수영장', required: true },
      { id: 'T1', type: 'text', prompt: '개선 의견', required: true, linkedScores: ['Q1', 'Q2'] },
    ] },
    { id: 'b', title: '영역B', subtitle: '', theme: 'soft-blue', questions: [
      { id: 'Q3', type: 'score', prompt: '식당', required: true },
      { id: 'C1', type: 'singleChoice', prompt: '방식', required: true, options: ['현장', '온라인'] },
    ] },
  ],
});

export const rec = (ref, category, answers, submittedAt = '2026-10-02T00:00:00Z') =>
  normalizeResponse({ version: '1', ref, affiliation: category, surveyType: 'C', answers, submittedAt }, { id: ref || 'x' });

export const miniRecords = () => [
  rec('G1-01', 'A사', { Q1: 12, Q2: 'NA', T1: '동선 개선 필요', Q3: 9, C1: '현장' }, '2026-10-02T01:00:00Z'),
  rec('G1-02', 'B사', { Q1: 8, Q2: 10, T1: '', Q3: 'NA', C1: '온라인' }, '2026-10-02T02:00:00Z'),
  rec('', 'A사', { Q1: 10, Q2: '', T1: '좋았어요', Q3: 11, C1: '현장' }, '2026-10-02T03:00:00Z'),
];
