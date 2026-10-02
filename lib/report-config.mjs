// Optional hosted-report config (./report-config.json). Pure and browser-safe; also used by tools/build-report-site.mjs.
// A config never carries a secret: the report password is typed in the UI only.
export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CONFIG_KEYS = ['collector', 'surveyBase', 'defaultSurvey', 'surveys'];

const tryUrl = (v) => { try { return new URL(v); } catch { return null; } };

/** Bare https origin (no path beyond "/", no credentials/query/hash). Returns the origin or null. */
export function httpsOrigin(v) {
  if (typeof v !== 'string') return null;
  const u = tryUrl(v.trim());
  if (!u || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
  if (/[?#]/.test(v)) return null;
  return u.origin;
}

/** https URL ending with "/", no credentials/query/hash. Returns the normalised URL string or null. */
export function httpsBase(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  const u = tryUrl(t);
  if (!u || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || /[?#]/.test(t) || !u.pathname.endsWith('/')) return null;
  return u.href;
}

/** Validates an untrusted parsed JSON value; invalid or unknown fields are dropped, never thrown. */
export function parseReportConfig(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const collector = httpsOrigin(raw.collector);
  if (collector) out.collector = collector;
  const surveyBase = httpsBase(raw.surveyBase);
  if (surveyBase) out.surveyBase = surveyBase;
  if (typeof raw.defaultSurvey === 'string' && ID_RE.test(raw.defaultSurvey)) out.defaultSurvey = raw.defaultSurvey;
  if (Array.isArray(raw.surveys)) out.surveys = [...new Set(raw.surveys.filter((x) => typeof x === 'string' && ID_RE.test(x)))].slice(0, 200);
  return out;
}

/** A bare id becomes `${surveyBase}${id}/survey.json` (hosted) or `../surveys/${id}/survey.json` (local); anything else is returned as typed. */
export function surveyUrlFrom(v, config = {}) {
  v = String(v ?? '').trim();
  if (!ID_RE.test(v)) return v;
  return config.surveyBase ? `${config.surveyBase}${v}/survey.json` : `../surveys/${v}/survey.json`;
}
