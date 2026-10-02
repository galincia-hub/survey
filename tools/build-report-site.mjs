#!/usr/bin/env node
// Static bundle of the web report for a private host (e.g. Vercel).
//   node tools/build-report-site.mjs --out <dir> --collector <origin> --survey-base <url> [--default-survey <id>] [--surveys a,b] [--embed-report-secret [env-file]]
// Writes only: reports/{index.html,report.js,styles.css,report-config.json}, engine/themes.css, lib/<modules report.js needs>, vercel.json.
// No secrets, responses, survey content, .env or wrangler.toml ever go into the bundle.
// Single exception, opt-in: --embed-report-secret writes REPORT_SECRET (never ADMIN_SECRET) to reports/report-secret.json, for a host that is
// itself access-protected (Vercel Authentication). Only allowed when the out dir is git-ignored or outside the repo; the value is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { httpsOrigin, httpsBase, ID_RE } from '../lib/report-config.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const ASSETS = ['reports/index.html', 'reports/report.js', 'reports/styles.css', 'engine/themes.css'];
const SECRET_FILE = 'reports/report-secret.json';
const DEFAULT_SECRETS_ENV = '/home/box/.config/survey-factory/collector-secrets.env';
const OPTS = { '--out': 'out', '--collector': 'collector', '--survey-base': 'surveyBase', '--default-survey': 'defaultSurvey', '--surveys': 'surveys' };

export class BuildError extends Error {}
const fail = (m) => { throw new BuildError(m); };

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length;) {
    if (argv[i] === '--embed-report-secret') { // optional value: path of the env file
      if ('embedSecret' in o) fail(`duplicate argument: ${argv[i]}`);
      const hasPath = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--');
      o.embedSecret = hasPath ? argv[i + 1] : DEFAULT_SECRETS_ENV;
      i += hasPath ? 2 : 1;
      continue;
    }
    const key = OPTS[argv[i]];
    if (!key) fail(`unknown argument: ${argv[i]}`);
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) fail(`missing value for ${argv[i]}`);
    if (key in o) fail(`duplicate argument: ${argv[i]}`);
    o[key] = argv[i + 1];
    i += 2;
  }
  return o;
}

export function validateInputs(o) {
  if (!o.out) fail('--out is required');
  if (!o.collector) fail('--collector is required');
  if (!o.surveyBase) fail('--survey-base is required');
  const collector = httpsOrigin(o.collector);
  if (!collector) fail('--collector must be a bare https origin (no path, credentials, query or fragment)');
  const surveyBase = httpsBase(o.surveyBase);
  if (!surveyBase) fail('--survey-base must be an https URL ending with "/" (no credentials, query or fragment)');
  const cfg = { collector, surveyBase };
  if (o.defaultSurvey !== undefined) {
    if (!ID_RE.test(o.defaultSurvey)) fail('--default-survey must be a survey id (lowercase letters, digits, hyphens)');
    cfg.defaultSurvey = o.defaultSurvey;
  }
  if (o.surveys !== undefined) {
    const ids = o.surveys.split(',').map((x) => x.trim()).filter(Boolean);
    for (const id of ids) if (!ID_RE.test(id)) fail(`--surveys contains an invalid id: ${id}`);
    cfg.surveys = [...new Set(ids)];
  }
  return cfg;
}

/** Real path of the deepest existing ancestor + the not-yet-existing remainder (so symlinks cannot smuggle an out dir into the repo). */
function resolveReal(p) {
  const abs = path.resolve(p);
  let head = abs, tail = '';
  while (!fs.existsSync(head)) { tail = path.join(path.basename(head), tail); head = path.dirname(head); }
  return path.join(fs.realpathSync(head), tail);
}

export function checkOutDir(out, repo = REPO) {
  const real = resolveReal(out), repoReal = fs.realpathSync(repo);
  const inside = (p, base) => p === base || p.startsWith(base + path.sep);
  if (inside(repoReal, real)) fail('refusing to write: --out contains the repository');
  if (inside(real, repoReal) && !inside(real, path.join(repoReal, 'dist'))) fail('refusing to write: --out is inside the repository (only dist/ is allowed)');
  if (inside(real, repoReal) && real === path.join(repoReal, 'dist')) fail('refusing to write: use a subdirectory of dist/, not dist/ itself');
  if (fs.existsSync(real)) {
    if (!fs.statSync(real).isDirectory()) fail('--out exists and is not a directory');
    if (fs.readdirSync(real).length && !fs.existsSync(path.join(real, 'vercel.json'))) fail('--out is not empty and is not a previous report-site build');
  }
  return real;
}

/** REPORT_SECRET (and, only to detect a mix-up, ADMIN_SECRET) from a KEY=VALUE env file. Error messages never contain a value. */
export function readReportSecret(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { fail(`cannot read the secrets env file: ${file}`); }
  const found = { REPORT_SECRET: [], ADMIN_SECRET: [] };
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(REPORT_SECRET|ADMIN_SECRET)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const q = /^(["'])(.*)\1$/.exec(m[2]);
    found[m[1]].push(q ? q[2] : m[2]);
  }
  if (found.REPORT_SECRET.length !== 1) fail(`the secrets env file must contain exactly one REPORT_SECRET line (found ${found.REPORT_SECRET.length})`);
  const [secret] = found.REPORT_SECRET;
  if (!/^[\x21-\x7e]{8,}$/.test(secret)) fail('REPORT_SECRET must be at least 8 printable characters without spaces');
  for (const admin of found.ADMIN_SECRET) if (admin && (secret === admin || secret.includes(admin) || admin.includes(secret))) fail('REPORT_SECRET overlaps ADMIN_SECRET: refusing to embed');
  return { secret, admin: found.ADMIN_SECRET.filter((v) => v.length >= 8) };
}

/** The secret may only be written to a git-ignored place inside the repo (or anywhere outside it). Fails closed when git cannot answer. */
export function checkSecretOutDir(out, repo = REPO) {
  const repoReal = fs.realpathSync(repo);
  if (!(out === repoReal || out.startsWith(repoReal + path.sep))) return;
  const r = spawnSync('git', ['-C', repoReal, 'check-ignore', '-q', '--', path.join(out, SECRET_FILE)], { stdio: 'ignore' });
  const probe = spawnSync('git', ['-C', repoReal, 'check-ignore', '-q', '--', path.join(out, '.sf-ignore-probe')], { stdio: 'ignore' });
  if (r.status !== 0 || probe.status !== 0) fail('refusing to embed the report secret: --out is inside the repository but not git-ignored');
}

/** Static ES-module imports of a file ("import x from './a.mjs'", "import './a.mjs'", "export * from './a.mjs'"). */
export function importsOf(source) {
  if (/\bimport\s*\(/.test(source)) fail('dynamic import() is not supported in bundled modules');
  const out = [];
  for (const m of source.matchAll(/(?:^|[;\n])\s*(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?(['"])([^'"]+)\1/g)) out.push(m[2]);
  return out;
}

/** Transitive closure of lib/*.mjs modules needed by reports/report.js. Returns repo-relative paths, sorted. */
export function libClosure(repo = REPO) {
  const seen = new Set(), queue = [path.join(repo, 'reports/report.js')];
  while (queue.length) {
    const file = queue.pop();
    for (const spec of importsOf(fs.readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) fail(`${path.relative(repo, file)} imports a non-relative module (${spec})`);
      const target = path.resolve(path.dirname(file), spec);
      const rel = path.relative(repo, target);
      if (!/^lib\/[a-z0-9-]+\.mjs$/.test(rel)) fail(`${path.relative(repo, file)} imports ${spec}, which is not a lib/*.mjs module`);
      if (!fs.existsSync(target)) fail(`missing module: ${rel}`);
      if (!seen.has(rel)) { seen.add(rel); queue.push(target); }
    }
  }
  return [...seen].sort();
}

export function buildVercelJson(cfg) {
  const origins = [...new Set([cfg.collector, new URL(cfg.surveyBase).origin])];
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", `connect-src 'self' ${origins.join(' ')}`,
    "form-action 'none'", "frame-ancestors 'none'", "base-uri 'none'"].join('; ');
  return {
    redirects: [{ source: '/', destination: '/reports/', permanent: false }],
    headers: [
      { source: '/(.*)', headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Cache-Control', value: 'no-store' },
      ] },
      { source: '/lib/(.*)', headers: [{ key: 'Content-Type', value: 'text/javascript; charset=utf-8' }] },
    ],
  };
}

const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b(?:ghp|gho|ghs|ghu|github_pat|xox[abprs]|glpat|AKIA|AIza)[-_A-Za-z0-9]{10,}/, 'provider token'],
  [/\bsk-[A-Za-z0-9]{16,}/, 'API key'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/, 'bearer literal'],
  [/(?:secret|token|passw(?:or)?d|api[_-]?key)\w*['"]?\s*[:=]\s*(['"])(?=[^'"]*\d)[A-Za-z0-9_\-+/=.]{16,}\1/i, 'credential assignment'],
  [/[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i, 'credentials in URL'],
  [/\b(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}\b/, 'high-entropy string'],
];
const FORBIDDEN_NAME = /(^|\/)(\.env[^/]*|wrangler\.toml|\.dev\.vars|survey\.json|[^/]*secret[^/]*|[^/]*\.(jsonl|xlsx|sqlite3?|csv|pem|key))$|(^|\/)(surveys|responses|collector|secrets)(\/|$)/i;

/** `secret` ({ file, value, admin[] }, optional) lets exactly one expected file hold the report secret: it must be {"reportSecret": <value>} and nothing else, and no other file may contain it. */
export function scanOutput(root, expected, secret) {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(path.relative(root, p).split(path.sep).join('/')); } })(root);
  files.sort();
  const want = [...expected].sort();
  const extra = files.filter((f) => !want.includes(f)), missing = want.filter((f) => !files.includes(f));
  if (extra.length) fail(`output contains files that are not on the allowlist: ${extra.join(', ')}`);
  if (missing.length) fail(`output is missing: ${missing.join(', ')}`);
  const literals = ['REPORT_SECRET', 'ADMIN_SECRET'].map((k) => process.env[k]).filter((v) => v && v.length >= 8);
  if (secret) literals.push(secret.value, ...secret.admin);
  if (secret && !files.includes(secret.file)) fail(`output is missing: ${secret.file}`);
  for (const f of files) {
    if (secret && f === secret.file) {
      let body;
      try { body = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')); } catch { fail(`${f} is not valid JSON`); }
      if (!body || typeof body !== 'object' || Object.keys(body).join() !== 'reportSecret' || body.reportSecret !== secret.value) fail(`${f} must contain exactly {"reportSecret": <REPORT_SECRET>}`);
      continue; // the one allowed secret-bearing file
    }
    if (FORBIDDEN_NAME.test(f)) fail(`forbidden output file: ${f}`);
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    const noUrls = text.replace(/https?:\/\/[^\s'"`)<>]+/g, ''); // URL paths (e.g. XML namespaces) are long but harmless
    for (const [re, what] of SECRET_PATTERNS) if (re.test(what === 'high-entropy string' ? noUrls : text)) fail(`secret-like content (${what}) in ${f}`);
    for (const v of literals) if (text.includes(v)) fail(`${f} contains the value of a secret environment variable`);
  }
  return files;
}

export function build(argv, { repo = REPO } = {}) {
  const o = parseArgs(argv);
  const cfg = validateInputs(o);
  const out = checkOutDir(o.out, repo);
  const lib = libClosure(repo);
  const expected = [...ASSETS.slice(0, 3), 'reports/report-config.json', ASSETS[3], ...lib, 'vercel.json'];
  let embed;
  if (o.embedSecret !== undefined) {
    embed = readReportSecret(o.embedSecret);
    checkSecretOutDir(out, repo);
    expected.push(SECRET_FILE);
  }

  fs.mkdirSync(out, { recursive: true });
  for (const d of ['reports', 'engine', 'lib']) fs.rmSync(path.join(out, d), { recursive: true, force: true }); // previous build only (vercel.json marker checked above)
  for (const rel of [...ASSETS, ...lib]) {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), path.join(out, rel));
  }
  fs.writeFileSync(path.join(out, 'reports/report-config.json'), JSON.stringify(cfg, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'vercel.json'), JSON.stringify(buildVercelJson(cfg), null, 2) + '\n');
  if (embed) fs.writeFileSync(path.join(out, SECRET_FILE), JSON.stringify({ reportSecret: embed.secret }) + '\n', { mode: 0o600 });
  try {
    const files = scanOutput(out, expected, embed && { file: SECRET_FILE, value: embed.secret, admin: embed.admin });
    return { out, files, config: cfg, ...(embed && { embeddedSecretChars: embed.secret.length }) };
  } catch (e) {
    for (const d of ['reports', 'engine', 'lib']) fs.rmSync(path.join(out, d), { recursive: true, force: true });
    fs.rmSync(path.join(out, 'vercel.json'), { force: true });
    throw e;
  }
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  try {
    const r = build(process.argv.slice(2));
    console.log(`built ${r.files.length} files in ${r.out}\n${r.files.map((f) => `  ${f}`).join('\n')}`);
    if (r.embeddedSecretChars) console.log(`embedded REPORT_SECRET (${r.embeddedSecretChars} chars) in ${SECRET_FILE}: upload this bundle only to the access-protected host`);
  } catch (e) {
    if (!(e instanceof BuildError)) throw e;
    console.error(`error: ${e.message}\nusage: node tools/build-report-site.mjs --out <dir> --collector <https origin> --survey-base <https url ending with /> [--default-survey <id>] [--surveys a,b] [--embed-report-secret [env-file]]`);
    process.exit(2);
  }
}
