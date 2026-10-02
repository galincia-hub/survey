#!/usr/bin/env node
// Node mock of the shared collector: same handle() as the Cloudflare Worker, in-memory (optionally jsonl-backed) store.
// Env: PORT (default 18792), REPORT_SECRET, ADMIN_SECRET, ALLOWED_ORIGINS, STORE_FILE (optional jsonl of envelopes).
import http from 'node:http';
import fs from 'node:fs';
import { handle } from '../collector/core.mjs';

export function memoryStore({ file } = {}) {
  const surveys = new Map(), responses = [];
  return {
    async getSurvey(id) { return surveys.get(id) ?? null; },
    async upsertSurvey(s) { surveys.set(s.surveyId, { ...s }); },
    async insertResponse(r) {
      if (r.submissionId) {
        const ex = responses.find((x) => x.surveyId === r.surveyId && x.submissionId === r.submissionId);
        if (ex) return { id: ex.id, duplicate: true };
      }
      responses.push(r);
      if (file) fs.appendFileSync(file, JSON.stringify({ id: r.id, surveyId: r.surveyId, receivedAt: r.receivedAt, raw: r.raw }) + '\n');
      return { id: r.id, duplicate: false };
    },
    async listResponses(id) {
      return responses.filter((r) => r.surveyId === id).map((r) => ({ id: r.id, surveyId: r.surveyId, receivedAt: r.receivedAt, raw: r.raw }));
    },
  };
}

/** @returns {Promise<{server, port, store, close}>}  port 0 = ephemeral; binds loopback only */
export async function startMock({ port = Number(process.env.PORT ?? 18792), env = process.env, store = memoryStore({ file: process.env.STORE_FILE }) } = {}) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const host = `http://${req.headers.host}`;
      const init = { method: req.method, headers: req.headers };
      if (!['GET', 'HEAD'].includes(req.method)) init.body = Buffer.concat(chunks);
      const out = await handle(new Request(host + req.url, init), env, store);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, store, port: server.address().port, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMock();
  console.log(`mock collector on http://127.0.0.1:${m.port}`);
}
