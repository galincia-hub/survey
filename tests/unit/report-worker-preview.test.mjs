import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ExcelJS from 'exceljs';
import { startMock } from '../../tools/mock-collector.mjs';
import { fetchWorkerRecords } from '../../tools/report.mjs';
import { mini } from './helpers.mjs';

const root = new URL('../../', import.meta.url).pathname;
const REPORT = 'cli-report-secret-4c91d7', ADMIN = 'cli-admin-secret-0a77e2';
const MOCK_PORT = 18801, PREVIEW_PORT = 18809;

test('report CLI --source worker: reads collector with REPORT_SECRET from env, never prints it, writes xlsx', async () => {
  const mock = await startMock({ port: MOCK_PORT, env: { REPORT_SECRET: REPORT, ADMIN_SECRET: ADMIN } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-report-worker-'));
  try {
    const sv = mini();
    const base = `http://127.0.0.1:${MOCK_PORT}`;
    assert.equal((await fetch(`${base}/v1/admin/surveys/${sv.surveyId}`, { method: 'PUT', headers: { Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ version: sv.version, deadline: '2099-12-31T23:59:59+09:00', status: 'open' }) })).status, 200);
    const payload = JSON.stringify({ version: '1', ref: 'G1-01', affiliation: 'A사', surveyType: 'C', answers: { Q1: 12, Q2: 'NA', T1: '워커 원문' }, submittedAt: '2026-10-02T01:00:00Z' });
    assert.equal((await fetch(`${base}/v1/submit/${sv.surveyId}`, { method: 'POST', body: payload })).status, 201);
    fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify(sv));
    // Async spawn: the in-process mock must keep serving while the CLI runs (spawnSync would deadlock).
    const cli = (env, endpoint = base) => new Promise((resolve) => {
      const c = spawn(process.execPath, [path.join(root, 'tools/report.mjs'), path.join(dir, 's.json'), '--source', 'worker', endpoint, '--out', path.join(dir, 'out')], { env: { ...process.env, REPORT_SECRET: '', ...env } });
      let stdout = '', stderr = ''; c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
      c.on('exit', (status) => resolve({ status, stdout, stderr }));
    });

    const ok = await cli({ REPORT_SECRET: REPORT });
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(!(ok.stdout + ok.stderr).includes(REPORT), 'secret must not be printed');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(dir, 'out', `${sv.surveyId}-report.xlsx`));
    assert.equal(wb.getWorksheet('raw').getCell('I2').value, payload); // raw preserved byte-for-byte
    assert.ok(!fs.readFileSync(path.join(dir, 'out/report.txt'), 'utf8').includes(REPORT));

    const wrong = await cli({ REPORT_SECRET: 'wrong-secret-value' });
    assert.notEqual(wrong.status, 0); assert.match(wrong.stderr, /401/); assert.ok(!(wrong.stdout + wrong.stderr).includes('wrong-secret-value'));
    const missing = await cli({});
    assert.notEqual(missing.status, 0); assert.match(missing.stderr, /REPORT_SECRET/);
    const remoteHttp = await cli({ REPORT_SECRET: REPORT }, 'http://collector.example.com');
    assert.notEqual(remoteHttp.status, 0); assert.match(remoteHttp.stderr, /https/);
    await assert.rejects(fetchWorkerRecords(`${base}/?x=1`, sv.surveyId, REPORT), /https/);
  } finally { await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

async function preview(env) {
  const child = spawn(process.execPath, ['tools/preview.mjs'], { cwd: root, env: { ...process.env, PREVIEW_PORT: String(PREVIEW_PORT), COLLECTOR_PORT: '18801', ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((r) => child.once('exit', (c) => r(c)));
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) return { code: await exited, err };
    try { const r = await fetch(`http://127.0.0.1:${PREVIEW_PORT}/reports/index.html`); return { csp: r.headers.get('content-security-policy'), stop: async () => { child.kill('SIGTERM'); await exited; } }; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  child.kill('SIGTERM'); throw new Error('preview did not start');
}

test('preview CSP: collector origin only via COLLECTOR_ORIGIN; invalid values refuse to start', async () => {
  const plain = await preview({ COLLECTOR_ORIGIN: '' });
  try { assert.ok(!plain.csp.includes('workers.dev')); assert.ok(!plain.csp.includes('unsafe-inline')); } finally { await plain.stop(); }
  const withOrigin = await preview({ COLLECTOR_ORIGIN: 'https://sf-collector.example.workers.dev' });
  try { assert.match(withOrigin.csp, /connect-src 'self' http:\/\/127\.0\.0\.1:\* https:\/\/sf-collector\.example\.workers\.dev;/); } finally { await withOrigin.stop(); }
  for (const bad of ['http://collector.example.com', 'https://collector.example.com/path', 'https://u:p@collector.example.com', '*', 'not a url']) {
    const r = await preview({ COLLECTOR_ORIGIN: bad });
    assert.ok(r.code !== undefined && r.code !== 0, bad); assert.match(r.err, /COLLECTOR_ORIGIN/);
  }
});
