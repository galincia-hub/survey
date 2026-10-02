import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiPrompt } from '../../lib/prompt.mjs';
import { buildKakao, containsForbidden, FORBIDDEN_WORD } from '../../lib/kakao.mjs';
import { surveyUrl } from '../../lib/url.mjs';
import { mini, miniRecords, fixture } from './helpers.mjs';

test('url rule', () => {
  assert.equal(surveyUrl('https://x.github.io/MD', 'abc-1'), 'https://x.github.io/MD/surveys/abc-1/');
  assert.equal(surveyUrl('https://x.io///', 'abc-1', 'G1-01'), 'https://x.io/surveys/abc-1/?ref=G1-01');
  assert.throws(() => surveyUrl('', 'a'));
});

test('ai prompt contents', () => {
  const p = buildAiPrompt(mini(), miniRecords());
  for (const s of ['미니 설문', '미니 행사', '목적입니다.', '기준 10점', '영역A', '영역B', '수영장', '평가 어려움', '0점으로 계산하지 않습니다', '추측하지 않습니다', '개선 우선순위', '참여 구분별 의견 차이', '반복', '강점', '약점', '응답수: 3']) assert.ok(p.includes(s), s);
  assert.ok(!containsForbidden(p));
});

test('kakao: all slots, url, deadline, sender; forbidden word absent', () => {
  const sv = mini(), url = surveyUrl('https://h.io', sv.surveyId);
  const k = buildKakao(sv, { url });
  for (const s of Object.values(sv.distribution)) assert.ok(k.includes(s), s);
  assert.ok(k.includes(url));
  assert.equal(containsForbidden(k), false);
  assert.equal(FORBIDDEN_WORD.codePointAt(0), 0xc775);
  // works on real fixtures with missing slots (defaults), baseUrl form
  const a = buildKakao(fixture('adora-ship-visit-001'), { baseUrl: 'https://h.io' });
  assert.ok(a.includes('https://h.io/surveys/adora-ship-visit-001/') && a.includes('응답 마감: 2026년 10월 6일') && !containsForbidden(a));
  const bad = mini(); bad.distribution.thanks = `x${FORBIDDEN_WORD}y`;
  assert.throws(() => buildKakao(bad, { url }));
});

test('kakao deadline falls back to formatted survey.deadline (KST)', () => {
  const sv = mini(); delete sv.distribution.deadlineText;
  assert.ok(buildKakao(sv, { url: 'u' }).includes('응답 마감: 2026년 10월 6일'));
});
