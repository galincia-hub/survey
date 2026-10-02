// Shared collector contract. Hosts: collector/worker.js (Cloudflare Worker, D1) and tools/mock-collector.mjs (Node).
// All contract logic lives in handle(); hosts only supply a store.
//
// Contract (docs/DESIGN.md §4):
//   POST /v1/submit/:surveyId          body = payload JSON (<= 64 KB) -> 201 {ok,id} | 400 invalid_payload | 404 unknown_survey | 410 survey_closed | 413 too_large
//   GET  /v1/status/:surveyId          -> {open, deadline}                       (public)
//   GET  /v1/responses/:surveyId       Authorization: Bearer REPORT_SECRET -> envelopes {id,surveyId,receivedAt,raw}
//   PUT  /v1/admin/surveys/:surveyId   Authorization: Bearer ADMIN_SECRET, body {version,deadline,status} (surveyId from path)
//
// Closing time is the exact ISO timestamp from content. Null means no time limit.

export const MAX_BODY_BYTES = 64 * 1024;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Epoch ms at which the survey stops accepting responses, or null. */
export function closeAtMs(deadline) {
  if (deadline === null || deadline === undefined || deadline === '') return null;
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return null;
  return t;
}

export function isOpen(survey, now = Date.now()) {
  if (survey.status === 'closed') return false;
  const c = closeAtMs(survey.deadline);
  return c === null || now <= c;
}

const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Submission-Id',
    'Access-Control-Max-Age': '600',
  };
}

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
/** Constant-time compare of Authorization bearer token against secret; fails closed if secret unset. */
async function bearerOk(request, secret) {
  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '');
  const [a, b] = await Promise.all([digest(m ? m[1] : ''), digest(String(secret ?? ''))]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 && Boolean(m) && Boolean(secret);
}

async function readBody(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_BODY_BYTES) return { tooLarge: true };
  const reader = request.body?.getReader();
  const chunks = []; let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { reader.cancel().catch(() => {}); return { tooLarge: true }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.byteLength; }
  return { bytes };
}

/**
 * store: { getSurvey(id), upsertSurvey(rec), insertResponse(rec) -> {id, duplicate}, listResponses(id) }
 * opts.now: epoch ms override (tests)
 */
export async function handle(request, env, store, opts = {}) {
  const now = opts.now ?? Date.now();
  const cors = corsHeaders(request, env);
  const reply = (status, body) => json(status, body, cors);
  const url = new URL(request.url);
  const m = /^\/v1\/(submit|status|responses|admin\/surveys)\/([^/]+)$/.exec(url.pathname);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!m) return reply(404, { ok: false, error: 'not_found' });
  const [, route, surveyId] = m;
  const method = { submit: 'POST', status: 'GET', responses: 'GET', 'admin/surveys': 'PUT' }[route];
  if (request.method !== method) return json(405, { ok: false, error: 'method_not_allowed' }, { ...cors, Allow: method });

  if (route === 'admin/surveys') {
    if (!(await bearerOk(request, env.ADMIN_SECRET))) return reply(401, { ok: false, error: 'unauthorized' });
    if (!ID_RE.test(surveyId)) return reply(400, { ok: false, error: 'invalid_survey_id' });
    let b;
    try { b = JSON.parse(new TextDecoder().decode((await readBody(request)).bytes ?? new Uint8Array())); } catch { b = null; }
    const okDeadline = b && (b.deadline === null || (typeof b.deadline === 'string' && !Number.isNaN(Date.parse(b.deadline))));
    if (!b || typeof b.version !== 'string' || !b.version || !okDeadline || !['open', 'closed'].includes(b.status)) {
      return reply(400, { ok: false, error: 'invalid_survey' });
    }
    const survey = { surveyId, version: b.version, deadline: b.deadline, status: b.status };
    await store.upsertSurvey(survey);
    return reply(200, { ok: true, survey });
  }

  if (route === 'responses') {
    if (!(await bearerOk(request, env.REPORT_SECRET))) return reply(401, { ok: false, error: 'unauthorized' });
    if (!(await store.getSurvey(surveyId))) return reply(404, { ok: false, error: 'unknown_survey' });
    const responses = await store.listResponses(surveyId);
    return reply(200, { ok: true, surveyId, count: responses.length, responses });
  }

  const survey = ID_RE.test(surveyId) ? await store.getSurvey(surveyId) : null;

  if (route === 'status') {
    if (!survey) return reply(404, { ok: false, error: 'unknown_survey' });
    return reply(200, { open: isOpen(survey, now), deadline: survey.deadline });
  }

  // submit
  const body = await readBody(request);
  if (body.tooLarge) return reply(413, { ok: false, error: 'too_large' });
  if (!survey) return reply(404, { ok: false, error: 'unknown_survey' });
  if (!isOpen(survey, now)) return reply(410, { ok: false, error: 'survey_closed' });
  let raw;
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body.bytes);
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('not an object');
  } catch {
    return reply(400, { ok: false, error: 'invalid_payload' });
  }
  const sid = request.headers.get('X-Submission-Id');
  const submissionId = sid && sid.length <= 128 ? sid : null;
  const res = await store.insertResponse({ id: crypto.randomUUID(), surveyId, receivedAt: new Date(now).toISOString(), raw, submissionId });
  return reply(201, { ok: true, id: res.id, ...(res.duplicate ? { duplicate: true } : {}) });
}

// ---- Cloudflare D1 store ----
export function d1Store(db) {
  return {
    async getSurvey(id) {
      const r = await db.prepare('SELECT survey_id, version, deadline, status FROM surveys WHERE survey_id = ?').bind(id).first();
      return r ? { surveyId: r.survey_id, version: r.version, deadline: r.deadline, status: r.status } : null;
    },
    async upsertSurvey(s) {
      await db.prepare('INSERT INTO surveys (survey_id, version, deadline, status) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(survey_id) DO UPDATE SET version = ?2, deadline = ?3, status = ?4')
        .bind(s.surveyId, s.version, s.deadline, s.status).run();
    },
    async insertResponse(r) {
      const ins = await db.prepare('INSERT OR IGNORE INTO responses (id, survey_id, received_at, raw, submission_id) VALUES (?, ?, ?, ?, ?)')
        .bind(r.id, r.surveyId, r.receivedAt, r.raw, r.submissionId).run();
      if (ins.meta.changes === 1) return { id: r.id, duplicate: false };
      const ex = await db.prepare('SELECT id FROM responses WHERE survey_id = ? AND submission_id = ?').bind(r.surveyId, r.submissionId).first();
      return { id: ex.id, duplicate: true };
    },
    async listResponses(id) {
      const { results } = await db.prepare('SELECT id, survey_id, received_at, raw FROM responses WHERE survey_id = ? ORDER BY received_at, rowid').bind(id).all();
      return results.map((x) => ({ id: x.id, surveyId: x.survey_id, receivedAt: x.received_at, raw: x.raw }));
    },
  };
}
