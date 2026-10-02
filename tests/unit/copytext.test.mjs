import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCopyText } from '../../lib/copytext.mjs';
import { linkedPrefix } from '../../lib/format.mjs';
import { mini, miniRecords } from './helpers.mjs';

const sv = mini(), recs = miniRecords();

test('linked line incl. 평가안함, unanswered "-", fallback to prompt without shortLabel', () => {
  const q = sv.sections[0].questions[2];
  assert.equal(linkedPrefix(sv, q, recs[0]), '[A사 | 공연 12 · 수영장 평가안함]');
  assert.equal(linkedPrefix(sv, q, recs[2]), '[A사 | 공연 10 · 수영장 -]');
  const noShort = structuredClone(sv); delete noShort.sections[0].questions[0].shortLabel;
  assert.equal(linkedPrefix(noShort, q, recs[0]), '[A사 | 공연 관련 시설 12 · 수영장 평가안함]');
  assert.equal(linkedPrefix(sv, { linkedScores: [] }, recs[0]), '[A사]');
});

test('copy mode: all (snapshot)', () => {
  assert.equal(buildCopyText(sv, recs, 'all'), `[설문 결과]
응답수: 3
평가기준: 기준 = 10점 (0~20점)

[영역A]
■ 공연 관련 시설
평균: 10.0
기준대비: +0.0
유효응답: 3
평가 어려움: 0
■ 수영장
평균: 10.0
기준대비: +0.0
유효응답: 1
평가 어려움: 1
■ 개선 의견
[관련 주관식]
[A사 | 공연 12 · 수영장 평가안함] 동선 개선 필요
[A사 | 공연 10 · 수영장 -] 좋았어요

[영역B]
■ 식당
평균: 10.0
기준대비: +0.0
유효응답: 2
평가 어려움: 1
■ 방식
선택: 현장 2 · 온라인 1

[참여 구분별 평균]
A사 (n=2): 영역A 11.0 · 영역B 10.0 · 종합 10.5
B사 (n=1): 영역A 9.0 · 영역B - · 종합 9.0

종합 평균: 10.0 (유효 6)
`);
});

test('copy mode: scores has no text; text has no score stats', () => {
  const s = buildCopyText(sv, recs, 'scores');
  assert.ok(s.includes('평균: ') && s.includes('[참여 구분별 평균]')); assert.ok(!s.includes('[관련 주관식]') && !s.includes('동선 개선'));
  assert.equal(buildCopyText(sv, recs, 'text'), `[설문 결과]
응답수: 3
평가기준: 기준 = 10점 (0~20점)

[영역A]
■ 개선 의견
[관련 주관식]
[A사 | 공연 12 · 수영장 평가안함] 동선 개선 필요
[A사 | 공연 10 · 수영장 -] 좋았어요
`);
  assert.throws(() => buildCopyText(sv, recs, 'bogus'));
});
