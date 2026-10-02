import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseMemo, parseDeadline, scaffold, buildIntakePrompt, INTAKE_RULES, ID_RE } from '../../lib/intake.mjs';
import { intake } from '../../tools/intake.mjs';
import { containsForbidden, FORBIDDEN_WORD } from '../../lib/kakao.mjs';

const here = (p) => new URL(p, import.meta.url).pathname;
const memo = fs.readFileSync(here('../fixtures/memos/sample-memo.txt'), 'utf8');
const schema = JSON.parse(fs.readFileSync(here('../../schema/survey.schema.json'), 'utf8'));

// minimal JSON-schema subset check (type, required, additionalProperties, enum, pattern, min*, items)
function check(s, v, p = '$') {
  const errs = [];
  if (s.enum && !s.enum.includes(v)) errs.push(`${p}: enum`);
  if (s.type === 'object') {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return [`${p}: not object`];
    for (const r of s.required ?? []) if (!(r in v)) errs.push(`${p}.${r}: required`);
    for (const k of Object.keys(v)) {
      if (!s.properties?.[k]) { if (s.additionalProperties === false) errs.push(`${p}.${k}: unknown`); continue; }
      errs.push(...check(s.properties[k], v[k], `${p}.${k}`));
    }
  } else if (s.type === 'array') {
    if (!Array.isArray(v)) return [`${p}: not array`];
    if (s.minItems && v.length < s.minItems) errs.push(`${p}: minItems`);
    if (s.items) v.forEach((x, i) => errs.push(...check(s.items, x, `${p}[${i}]`)));
  } else if (s.type === 'string') {
    if (typeof v !== 'string') return [`${p}: not string`];
    if (s.minLength && v.length < s.minLength) errs.push(`${p}: minLength`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${p}: pattern`);
  } else if (s.type === 'boolean' && typeof v !== 'boolean') errs.push(`${p}: not boolean`);
  else if ((s.type === 'number' || s.type === 'integer') && typeof v !== 'number') errs.push(`${p}: not number`);
  return errs;
}

test('parseMemo: labelled lines, headings, bullets', () => {
  const p = parseMemo(memo);
  assert.equal(p.event, '샘플 파트너 워크숍'); assert.equal(p.baseline, '지난 행사 = 10점'); assert.equal(p.sender, '샘플 운영팀');
  assert.equal(p.questions.filter((q) => q.heading).length, 2); assert.equal(p.questions.filter((q) => q.bullet).length, 6);
});

test('parseDeadline formats', () => {
  assert.deepEqual(parseDeadline('2026-10-06'), { iso: '2026-10-06T23:59:59+09:00', date: '2026-10-06' });
  assert.equal(parseDeadline('2026년 11월 10일').iso, '2026-11-10T23:59:59+09:00');
  assert.equal(parseDeadline('2026.1.5').date, '2026-01-05');
  assert.equal(parseDeadline('2026-10-06T12:00:00+09:00').iso, '2026-10-06T12:00:00+09:00');
  assert.equal(parseDeadline('내일'), null); assert.equal(parseDeadline('2026-13-40'), null);
});

test('scaffold: schema-valid draft with defaults, linked text, dropped identity question', () => {
  const { survey, todos, warnings } = scaffold(memo, { id: 'workshop-feedback-001', today: '2026-10-02' });
  assert.deepEqual(check(schema, survey), []);
  assert.deepEqual(todos, []);
  assert.equal(survey.deadline, '2026-11-10T23:59:59+09:00'); assert.equal(survey.eventDate, '2026-11-03');
  assert.equal(survey.distribution.deadlineText, '응답 마감: 2026년 11월 10일');
  assert.deepEqual([survey.scale.min, survey.scale.max, survey.scale.baseline, survey.scale.baselineLabel], [0, 20, 10, '지난 행사 = 10점']);
  assert.deepEqual(survey.respondent.options, ['협력사', '운영 파트너', '기타']);
  assert.deepEqual(survey.sections.map((s) => s.title), ['프로그램', '운영']);
  const [a, b] = survey.sections;
  assert.deepEqual(a.questions.map((q) => [q.id, q.type]), [['Q01', 'score'], ['Q02', 'score'], ['Q03', 'text']]);
  assert.deepEqual(a.questions[2].linkedScores, ['Q01', 'Q02']);
  // identity-like bullet dropped + warned; section B gets an auto linked text
  assert.ok(!JSON.stringify(b).includes('성함')); assert.ok(warnings.some((w) => w.includes('성함')));
  assert.equal(b.questions.at(-1).type, 'text'); assert.deepEqual(b.questions.at(-1).linkedScores, ['Q04']);
  assert.equal(b.questions.find((q) => q.type === 'singleChoice').options.join('|'), '현장|온라인');
  assert.equal(survey.privacy.allowIdentity, false); assert.deepEqual(survey.privacy.identityQuestions, []);
  assert.deepEqual(a.theme === 'sage' && b.theme === 'soft-blue', true);
  assert.ok(ID_RE.test(survey.surveyId)); assert.ok(!containsForbidden(JSON.stringify(survey)));
});

test('explicit (식별허용) goes to per-question allowlist', () => {
  const { survey } = scaffold('행사: X\n질문:\n## A\n- 점수 문항\n- 담당자 성함을 적어주세요 (주관식)(식별허용)\n', { id: 'x-event-001' });
  const q = survey.sections[0].questions.find((x) => x.identity);
  assert.deepEqual(survey.privacy, { allowIdentity: true, identityQuestions: [q.id] });
});

test('no 비교기준 -> neutral scale + TODO; missing fields become TODO markers, not invented facts', () => {
  const { survey, todos } = scaffold('행사: 최소 행사\n질문:\n- 문항 하나\n', { id: 'min-event-001' });
  assert.equal(survey.scale.max, 10); assert.equal(survey.scale.baseline, 5);
  for (const t of ['마감일', '행사일', '목적', '발신자']) assert.ok(todos.some((x) => x.startsWith(t)), t);
  assert.ok(todos.some((x) => x.startsWith('비교기준'))); assert.ok(todos.some((x) => x.startsWith('영역 이름')));
  assert.match(survey.deadline, /^TODO\(/); assert.match(survey.eventDate, /^TODO\(/);
});

test('prompt: rules, ids, memo, draft; docs/INTAKE.md carries the same rules', () => {
  const { survey, todos, warnings } = scaffold(memo, { id: 'workshop-feedback-001' });
  const p = buildIntakePrompt({ memo, draft: survey, todos, warnings, existingIds: ['adora-ship-visit-001'] });
  for (const r of INTAKE_RULES) assert.ok(p.includes(r));
  assert.ok(p.includes('adora-ship-visit-001') && p.includes('샘플 파트너 워크숍') && p.includes('"surveyId": "workshop-feedback-001"'));
  assert.ok(!containsForbidden(p));
  const doc = fs.readFileSync(here('../../docs/INTAKE.md'), 'utf8');
  for (const r of INTAKE_RULES) assert.ok(doc.includes(r), r);
  assert.ok(doc.includes('node tools/intake.mjs'));
});

test('intake CLI: writes survey + prompt, refuses overwrite, rejects bad id / forbidden word', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-intake-'));
  const memoPath = path.join(dir, 'memo.txt'); fs.writeFileSync(memoPath, memo);
  const surveysDir = path.join(dir, 'surveys'); fs.mkdirSync(path.join(surveysDir, 'old-event-001'), { recursive: true });
  const r = intake({ memoPath, id: 'workshop-feedback-001', surveysDir, today: '2026-10-02' });
  assert.equal(r.out, path.join(surveysDir, 'workshop-feedback-001/survey.json'));
  assert.deepEqual(check(schema, JSON.parse(fs.readFileSync(r.out, 'utf8'))), []);
  assert.ok(fs.readFileSync(`${r.out}.prompt.md`, 'utf8').includes('old-event-001'));
  assert.throws(() => intake({ memoPath, id: 'workshop-feedback-001', surveysDir }), /refusing to overwrite/);
  assert.throws(() => intake({ memoPath, id: 'old-event-001', surveysDir }), /refusing to overwrite/);
  assert.throws(() => intake({ memoPath, id: 'Bad_ID', surveysDir }), /surveyId/);
  assert.throws(() => intake({ memoPath, id: 'no-number', surveysDir }), /surveyId/);
  fs.writeFileSync(memoPath, `행사: a${FORBIDDEN_WORD}b\n`);
  assert.throws(() => intake({ memoPath, id: 'other-event-001', surveysDir }), /forbidden/);
  const cli = spawnSync('node', [here('../../tools/intake.mjs'), memoPath, '--id', 'workshop-feedback-001', '--surveys-dir', surveysDir], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
  fs.writeFileSync(memoPath, memo);
  const out = execFileSync('node', [here('../../tools/intake.mjs'), memoPath, '--id', 'cli-event-001', '--surveys-dir', surveysDir], { encoding: 'utf8' });
  assert.ok(out.includes('survey.json.prompt.md'));
});
