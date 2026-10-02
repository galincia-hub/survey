import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { startMock } from '../../tools/mock-collector.mjs';
import { closeAtMs, isOpen } from '../../collector/core.mjs';
import { contractSuite, SECRETS, ORIGIN } from './contract.mjs';

const root = new URL('../../', import.meta.url).pathname;
const wrangler = path.join(root, 'node_modules/.bin/wrangler');
const MOCK_PORT = 18803, WORKER_PORT = 18804, INSPECTOR_PORT = 18805;

// ---------- unit: deadline rule ----------
test('close rule: exact timestamp, shared with client', () => {
  const T = (s) => Date.parse(s);
  const dl = '2026-10-06T23:59:59+09:00';
  assert.equal(closeAtMs(dl), T(dl));
  assert.equal(closeAtMs('2026-10-06T12:00:00+09:00'), T('2026-10-06T03:00:00Z'));
  assert.equal(closeAtMs(null), null);
  const s = { deadline: dl, status: 'open' };
  assert.equal(isOpen(s, T(dl)), true);
  assert.equal(isOpen(s, T(dl)+1), false);
  assert.equal(isOpen({ deadline: null, status: 'closed' }, 0), false);
});

// ---------- mock ----------
{
  let mock;
  before(async () => { mock = await startMock({ port: MOCK_PORT, env: { REPORT_SECRET: SECRETS.report, ADMIN_SECRET: SECRETS.admin, ALLOWED_ORIGINS: ORIGIN } }); });
  after(() => mock.close());
  contractSuite('mock', () => `http://127.0.0.1:${mock.port}`);
}

// ---------- real worker via wrangler dev --local ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-wrangler-'));
const cfg = path.join(tmp, 'wrangler.toml');
const state = path.join(tmp, 'state');
const env = { ...process.env, XDG_CONFIG_WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' };
let child, log = '', workerUp = false, skipReason = null;

async function waitPort(port, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`wrangler exited ${child.exitCode}`);
    const ok = await new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('timeout waiting for wrangler dev');
}

before(async () => {
  try {
    fs.writeFileSync(cfg, `name = "sf-collector-test"\nmain = "${path.join(root, 'collector/worker.js')}"\ncompatibility_date = "2026-04-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "sf-test"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n`);
    fs.rmSync(state, { recursive: true, force: true });
    const mig = spawnSync(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', state, '--config', cfg, '--file', path.join(root, 'collector/schema.sql')], { env, encoding: 'utf8', cwd: tmp, timeout: 120000 });
    if (mig.status !== 0) throw new Error('d1 migrate failed: ' + (mig.stdout + mig.stderr).slice(-600));
    child = spawn(wrangler, ['dev', '--local', '--ip', '127.0.0.1', '--port', String(WORKER_PORT), '--inspector-port', String(INSPECTOR_PORT), '--persist-to', state, '--config', cfg,
      '--var', `REPORT_SECRET:${SECRETS.report}`, '--var', `ADMIN_SECRET:${SECRETS.admin}`, '--var', `ALLOWED_ORIGINS:${ORIGIN}`],
      { env, cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
    await waitPort(WORKER_PORT, 90000);
    for (let i = 0; ; i++) { // port can open before workerd serves; wait for a real HTTP answer
      try { if ((await fetch(`http://127.0.0.1:${WORKER_PORT}/v1/status/probe`)).status === 404) break; } catch {}
      if (i > 120) throw new Error('worker never answered');
      await new Promise((r) => setTimeout(r, 500));
    }
    workerUp = true;
    console.log('# collector path: REAL worker via wrangler dev --local (Miniflare + local D1)');
  } catch (e) {
    skipReason = `${e.message}\n${log.slice(-800)}`;
    console.log('# collector path: wrangler unavailable -> worker contract tests FAIL (see below)');
  }
});
after(() => { if (child && child.exitCode === null) child.kill('SIGTERM'); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(state, { recursive: true, force: true }); });

test('wrangler dev --local started', () => { assert.ok(workerUp, skipReason ?? 'not started'); });
contractSuite('worker', () => `http://127.0.0.1:${WORKER_PORT}`);
