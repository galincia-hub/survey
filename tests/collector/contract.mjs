// Contract tests shared by the Node mock and the real worker (wrangler dev --local).
import test from 'node:test';
import assert from 'node:assert/strict';

export const SECRETS = { report: 'test-report-secret', admin: 'test-admin-secret' };
export const ORIGIN = 'https://allowed.example';

export function contractSuite(label, getBase) {
  const url = (p) => getBase() + p;
  const put = (id, body, tok = SECRETS.admin) => fetch(url(`/v1/admin/surveys/${id}`), { method: 'PUT', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
  const post = (id, body, headers = {}) => fetch(url(`/v1/submit/${id}`), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  const list = (id, tok) => fetch(url(`/v1/responses/${id}`), { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });

  test(`[${label}] admin upsert requires secret and validates`, async () => {
    assert.equal((await put('open-1', { version: '1', deadline: '2099-12-31T23:59:59+09:00', status: 'open' }, 'wrong')).status, 401);
    assert.equal((await fetch(url('/v1/admin/surveys/open-1'), { method: 'PUT', body: '{}' })).status, 401);
    assert.equal((await put('open-1', { version: '', deadline: null, status: 'open' })).status, 400);
    assert.equal((await put('open-1', { version: '1', deadline: 'nope', status: 'open' })).status, 400);
    const ok = await put('open-1', { version: '1', deadline: '2099-12-31T23:59:59+09:00', status: 'open' });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).survey, { surveyId: 'open-1', version: '1', deadline: '2099-12-31T23:59:59+09:00', status: 'open' });
    // upsert replaces
    await put('open-1', { version: '2', deadline: null, status: 'open' });
    assert.equal((await (await fetch(url('/v1/status/open-1'))).json()).deadline, null);
  });

  test(`[${label}] submit ok -> raw byte-equal on read; status public`, async () => {
    await put('open-1', { version: '1', deadline: '2099-12-31T23:59:59+09:00', status: 'open' });
    const raw = '{ "version":"v1",  "ref":"", "affiliation":"참가자","answers":{"Q1":12,"T":"한글 \\" 줄\\n바꿈 😀"},"submittedAt":"2026-10-02T00:00:00.000Z" }';
    const r = await post('open-1', raw);
    assert.equal(r.status, 201);
    const { ok, id } = await r.json();
    assert.ok(ok && id);
    const read = await (await list('open-1', SECRETS.report)).json();
    const env = read.responses.find((x) => x.id === id);
    assert.equal(env.raw, raw);
    assert.equal(env.surveyId, 'open-1');
    assert.ok(!Number.isNaN(Date.parse(env.receivedAt)));
    assert.deepEqual(await (await fetch(url('/v1/status/open-1'))).json(), { open: true, deadline: '2099-12-31T23:59:59+09:00' });
  });

  test(`[${label}] X-Submission-Id is idempotent`, async () => {
    const a = await (await post('open-1', '{"answers":{"a":1}}', { 'X-Submission-Id': 'sub-1' })).json();
    const b = await post('open-1', '{"answers":{"a":1}}', { 'X-Submission-Id': 'sub-1' });
    assert.equal(b.status, 201);
    const bj = await b.json();
    assert.equal(bj.id, a.id); assert.equal(bj.duplicate, true);
    const n = (await (await list('open-1', SECRETS.report)).json()).responses.filter((x) => x.raw === '{"answers":{"a":1}}' && x.id === a.id).length;
    assert.equal(n, 1);
  });

  test(`[${label}] errors: 404 unknown, 400 bad JSON, 413 too large`, async () => {
    assert.equal((await post('no-such', '{}')).status, 404);
    assert.equal((await fetch(url('/v1/status/no-such'))).status, 404);
    assert.equal((await post('open-1', '{not json')).status, 400);
    assert.equal((await post('open-1', '[1,2]')).status, 400);
    // minimal shape gate: `answers` must be an object (legacy and standard payloads both have it)
    for (const bad of ['{}', '{"a":1}', '{"answers":null}', '{"answers":[1]}', '{"answers":"x"}', '{"answers":3}']) {
      const r = await post('open-1', bad);
      assert.equal(r.status, 400, bad); assert.equal((await r.json()).error, 'invalid_payload');
    }
    const stored = (await (await list('open-1', SECRETS.report)).json()).responses.map((x) => x.raw);
    assert.ok(!stored.includes('{}') && !stored.includes('{"a":1}'), 'rejected payloads are not stored');
    assert.equal((await post('open-1', '')).status, 400);
    const r = await post('open-1', JSON.stringify({ pad: 'x'.repeat(70 * 1024) }));
    assert.equal(r.status, 413);
    assert.equal((await r.json()).error, 'too_large');
    assert.equal((await post('open-1', JSON.stringify({ answers: { pad: 'x'.repeat(60 * 1024) } }))).status, 201);
  });

  test(`[${label}] closed: past deadline and status=closed -> 410`, async () => {
    await put('past-1', { version: '1', deadline: '2020-01-01T23:59:59+09:00', status: 'open' });
    const r = await post('past-1', '{}');
    assert.equal(r.status, 410); assert.equal((await r.json()).error, 'survey_closed');
    assert.equal((await (await fetch(url('/v1/status/past-1'))).json()).open, false);
    await put('manual-1', { version: '1', deadline: null, status: 'closed' });
    assert.equal((await post('manual-1', '{}')).status, 410);
    await put('manual-1', { version: '1', deadline: null, status: 'open' });
    assert.equal((await post('manual-1', '{"answers":{}}')).status, 201);
  });

  test(`[${label}] responses: 401 without / wrong secret (admin secret not accepted)`, async () => {
    assert.equal((await list('open-1')).status, 401);
    assert.equal((await list('open-1', 'wrong')).status, 401);
    assert.equal((await list('open-1', SECRETS.admin)).status, 401);
    assert.equal((await list('open-1', SECRETS.report)).status, 200);
    assert.equal((await list('no-such', SECRETS.report)).status, 404);
  });

  test(`[${label}] CORS allowlist and preflight`, async () => {
    const ok = await fetch(url('/v1/status/open-1'), { headers: { Origin: ORIGIN } });
    assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
    const bad = await fetch(url('/v1/status/open-1'), { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(url('/v1/submit/open-1'), { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(pre.headers.get('access-control-allow-headers'), /X-Submission-Id/i);
    const err = await fetch(url('/v1/submit/no-such'), { method: 'POST', headers: { Origin: ORIGIN }, body: '{}' });
    assert.equal(err.headers.get('access-control-allow-origin'), ORIGIN);
  });

  test(`[${label}] routing: unknown path 404, wrong method 405`, async () => {
    assert.equal((await fetch(url('/nope'))).status, 404);
    assert.equal((await fetch(url('/v1/submit/open-1'))).status, 405);
  });
}
