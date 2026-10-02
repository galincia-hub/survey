import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, classify } from '../../lib/stats.mjs';
import { normalizeResponse, dedupeLatest, isLate, markLate } from '../../lib/normalize.mjs';
import { mini, rec, miniRecords, fixture } from './helpers.mjs';

test('NA exclusion: [12, NA, 8] -> avg 10, valid 2, NA 1', () => {
  const sv = mini();
  const recs = [rec('a', 'A사', { Q1: 12 }), rec('b', 'A사', { Q1: 'NA' }), rec('c', 'B사', { Q1: 8 })];
  const q = computeStats(sv, recs).questions.Q1;
  assert.equal(q.avg, 10); assert.equal(q.valid, 2); assert.equal(q.na, 1); assert.equal(q.unanswered, 0);
  assert.equal(q.delta, 0); assert.equal(q.min, 8); assert.equal(q.max, 12);
});

test('empty string and missing are unanswered, never zero', () => {
  const sv = mini();
  const st = computeStats(sv, [rec('a', 'A사', { Q1: '' }), rec('b', 'A사', {}), rec('c', 'A사', { Q1: 0 })]);
  assert.equal(st.questions.Q1.unanswered, 2); assert.equal(st.questions.Q1.valid, 1); assert.equal(st.questions.Q1.avg, 0);
  assert.equal(classify('NA').kind, 'na');
});

test('category, area (pooled) and overall stats', () => {
  const st = computeStats(mini(), miniRecords());
  assert.deepEqual(st.nByCategory, { 'A사': 2, 'B사': 1 });
  assert.equal(st.questions.Q1.byCategory['A사'].avg, 11);
  assert.equal(st.questions.Q1.byCategory['B사'].avg, 8);
  // area a valid scores: Q1 12,8,10 + Q2 10 => 40/4
  assert.equal(st.areas.a.avg, 10); assert.equal(st.areas.a.valid, 4);
  assert.equal(st.areas.b.avg, 10); // 9, 11 (NA excluded)
  assert.equal(st.overall.valid, 6); assert.equal(st.overall.avg, 60 / 6);
  assert.equal(st.areas.a.byCategory['A사'], 11); // 12,10
});

test('normalize legacy and standard; ref "" -> 미지정; raw preserved', () => {
  const legacyRaw = '{"version":"v","ref":"","affiliation":"모두투어","surveyType":"C","answers":{"O01":5},"submittedAt":"2026-10-01T00:00:00Z"}';
  const l = normalizeResponse(legacyRaw);
  assert.equal(l.ref, '미지정'); assert.equal(l.category, '모두투어'); assert.equal(l.raw, legacyRaw); assert.equal(l.format, 'legacy');
  const s = normalizeResponse({ surveyId: 'x', version: '1', ref: 'G1-01', respondentCategory: '팬스타', answers: {}, submittedAt: 't' });
  assert.equal(s.category, '팬스타'); assert.equal(s.surveyId, 'x'); assert.equal(s.format, 'standard');
  assert.equal(normalizeResponse({ respondentCategory: 'c', answers: {} }).ref, '미지정');
});

test('dedupe: latest per non-default ref; 미지정 never deduped', () => {
  const a = rec('G1-01', 'A사', { Q1: 1 }, '2026-10-02T05:00:00Z');
  const b = rec('G1-01', 'A사', { Q1: 2 }, '2026-10-02T06:00:00Z');
  const c = rec('G1-01', 'A사', { Q1: 3 }, '2026-10-02T04:00:00Z');
  const u1 = rec('', 'A사', {}), u2 = rec('', 'A사', {});
  const { records, duplicates } = dedupeLatest([a, b, c, u1, u2]);
  assert.deepEqual(records, [b, u1, u2]); assert.deepEqual(duplicates, [a, c]);
});

test('adora fixture computes without error (18 questions)', () => {
  const sv = fixture('adora-ship-visit-001');
  const st = computeStats(sv, []);
  assert.equal(Object.keys(st.questions).length, sv.sections.flatMap((s) => s.questions).filter((q) => q.type === 'score').length);
  assert.equal(st.overall.avg, null);
});

test('isLate: receivedAt first, submittedAt fallback, equal-to-deadline is on time, no deadline is never late', () => {
  const D = '2026-10-06T23:59:59+09:00'; // 2026-10-06T14:59:59Z
  assert.equal(isLate({ receivedAt: '2026-10-06T15:00:00Z', submittedAt: '2026-10-01T00:00:00Z' }, D), true, 'receivedAt wins over submittedAt');
  assert.equal(isLate({ receivedAt: '2026-10-06T14:59:59Z', submittedAt: '2026-10-09T00:00:00Z' }, D), false, 'equal is on time; submittedAt ignored when receivedAt parses');
  assert.equal(isLate({ receivedAt: null, submittedAt: '2026-10-07T00:00:00Z' }, D), true, 'submittedAt when receivedAt absent');
  assert.equal(isLate({ receivedAt: '2026. 10. 9 오전 10:00:00', submittedAt: '2026-10-01T00:00:00Z' }, D), false, 'unparsable receivedAt falls back to submittedAt');
  assert.equal(isLate({ receivedAt: null, submittedAt: null }, D), false, 'no usable time');
  assert.equal(isLate({ receivedAt: '2030-01-01T00:00:00Z' }, null), false, 'no deadline');
  assert.equal(isLate({ receivedAt: '2030-01-01T00:00:00Z' }, 'garbage'), false);
  const recs = [{ receivedAt: '2026-10-07T00:00:00Z' }, { receivedAt: '2026-10-05T00:00:00Z' }];
  assert.equal(markLate(recs, D), recs); assert.deepEqual(recs.map((r) => r.late), [true, false]);
});
