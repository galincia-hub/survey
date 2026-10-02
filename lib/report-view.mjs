// Pure HTML builders for the designed web report (browser + Node). All text is escaped; bars are inline SVG so no inline style
// attributes are needed (CSP style-src 'self'). Only existing stats are rendered; choice distributions come from choiceStats().
import { scoreQuestions, choiceStats } from './stats.mjs';
import { fmt1, fmtDelta, label, scoreToken } from './format.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const SECTION_CYCLE = ['sage', 'soft-blue', 'warm-beige', 'lavender'];
const clamp = (n) => Math.min(100, Math.max(0, n));
const num = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

/** Theme attribute value for a section: explicit theme, else the sage > soft-blue > warm-beige > lavender cycle; "default" -> none. */
export function sectionTheme(survey, index) {
  const t = survey.sections[index]?.theme ?? SECTION_CYCLE[index % SECTION_CYCLE.length];
  return t === 'default' ? '' : t;
}
const themeAttr = (survey, i) => { const t = sectionTheme(survey, i); return t ? ` data-theme="${esc(t)}"` : ''; };

/** "2026-10-06T23:59:59+09:00" -> "2026-10-06 23:59 (+09:00)"; date-only values pass through; anything else is returned as-is. */
export function fmtWhen(v) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(String(v ?? ''));
  if (!m) return String(v ?? '');
  return m[2] ? `${m[1]} ${m[2]}${m[3] ? ` (${m[3] === 'Z' ? 'UTC' : m[3]})` : ''}` : m[1];
}

const dir = (d) => { const r = Math.round(d * 10) / 10; return r > 0 ? 'up' : r < 0 ? 'down' : 'flat'; };
export function deltaChip(d) {
  if (d === null || d === undefined || !Number.isFinite(d)) return '<span class="delta none">-</span>';
  const k = dir(d);
  return `<span class="delta ${k}">${k === 'up' ? '▲' : k === 'down' ? '▼' : '＝'} ${esc(fmtDelta(d))}</span>`;
}

/** Horizontal bar: value on [min,max] with an optional baseline marker. Geometry in attributes only. */
export function scoreBar({ value, min, max, baseline = null, cls = '', title = '' }) {
  const span = max - min || 1;
  const p = (v) => num(clamp(((v - min) / span) * 100));
  const hasV = value !== null && value !== undefined && Number.isFinite(value);
  return `<svg class="bar ${cls}" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><rect class="bar-track" x="0" y="0" width="100" height="10"/>${hasV ? `<rect class="bar-fill" x="0" y="0" width="${p(value)}" height="10"/>` : ''}${baseline !== null && baseline !== undefined ? `<line class="bar-base" x1="${p(baseline)}" x2="${p(baseline)}" y1="0" y2="10"/>` : ''}</svg>`;
}

const scaleOf = (survey, q) => ({ min: q?.min ?? survey.scale?.min ?? 0, max: q?.max ?? survey.scale?.max ?? 10 });

function header(survey, { all, records, duplicates }) {
  const late = all.filter((r) => r.late).length;
  const period = [survey.eventDate ? `<li><span>행사일</span><b>${esc(fmtWhen(survey.eventDate))}</b></li>` : '', survey.deadline ? `<li><span>응답 마감</span><b>${esc(fmtWhen(survey.deadline))}</b></li>` : ''].join('');
  return `<header class="hero" id="rp-header">
  ${survey.eventName ? `<p class="eyebrow" id="rp-event">${esc(survey.eventName)}</p>` : ''}
  <h2 id="rp-title">${esc(survey.title)}</h2>
  <ul class="meta" id="rp-period">${period}<li><span>응답</span><b id="rp-count">${records.length}건</b></li></ul>
  <p class="hero-note muted">수신 ${all.length}건 · 중복 ${duplicates.length}건 제외${late ? ` · 마감 후 수신 ${late}건 포함` : ''}</p>
</header>`;
}

function kpis(survey, { all, records, duplicates, stats }) {
  const sc = survey.scale ?? {};
  const base = sc.enabled ? sc.baseline : null;
  const overallDelta = stats.overall.avg === null || base === null || base === undefined ? null : stats.overall.avg - base;
  const na = Object.values(stats.questions).reduce((n, q) => n + q.na, 0);
  const range = scaleOf(survey);
  const cards = [
    `<article class="kpi" id="kpi-count"><h3>응답 수</h3><p class="big">${stats.n}</p><p class="sub">집계 ${records.length} / 수신 ${all.length} · 중복 ${duplicates.length}</p></article>`,
    `<article class="kpi" id="kpi-overall"><h3>종합 평균</h3><p class="big">${esc(fmt1(stats.overall.avg))}${deltaChip(overallDelta)}</p>${scoreBar({ value: stats.overall.avg, ...range, baseline: base, title: `종합 평균 ${fmt1(stats.overall.avg)}` })}<p class="sub">${base !== null && base !== undefined ? `기준 ${esc(base)}점${sc.baselineLabel ? ` (${esc(sc.baselineLabel)})` : ''}` : '기준 없음'} · 유효 ${stats.overall.valid}${na ? ` · 평가 어려움 ${na}` : ''}</p></article>`,
  ];
  survey.sections.forEach((s, i) => {
    const a = stats.areas[s.id];
    if (!a) return;
    const d = a.avg === null || base === null || base === undefined ? null : a.avg - base;
    cards.push(`<article class="kpi sec" id="kpi-area-${esc(s.id)}"${themeAttr(survey, i)}><h3>${esc(s.title)}</h3><p class="big">${esc(fmt1(a.avg))}${deltaChip(d)}</p>${scoreBar({ value: a.avg, ...range, baseline: base, title: `${s.title} 평균 ${fmt1(a.avg)}` })}<p class="sub">유효 ${a.valid}</p></article>`);
  });
  return `<section id="rp-kpis" class="block"><div class="kpis">${cards.join('')}</div></section>`;
}

function questionRow(survey, q, st) {
  const { min, max } = scaleOf(survey, q);
  const title = `${q.prompt}: 평균 ${fmt1(st.avg)}`;
  return `<li class="qrow" id="q-${esc(q.id)}" data-q="${esc(q.id)}">
    <div class="qtext"><span class="qid">${esc(q.id)}</span> ${esc(q.prompt)}</div>
    <div class="qbar">${scoreBar({ value: st.avg, min, max, baseline: st.baseline, title })}</div>
    <div class="qval"><b>${esc(fmt1(st.avg))}</b>${deltaChip(st.delta)}</div>
    <div class="qmeta muted">유효 ${st.valid} · 평가 어려움 ${st.na}${st.unanswered ? ` · 미응답 ${st.unanswered}` : ''}${st.min !== null ? ` · ${st.min}~${st.max}` : ''}</div>
  </li>`;
}

function sections(survey, { stats }) {
  const sc = survey.scale ?? {};
  const legend = sc.enabled ? `<p class="legend muted"><svg class="swatch" viewBox="0 0 10 10" aria-hidden="true"><rect class="bar-fill" width="10" height="10"/></svg> 평균 <svg class="swatch" viewBox="0 0 10 10" aria-hidden="true"><line class="bar-base" x1="5" x2="5" y1="0" y2="10"/></svg> 기준 ${esc(sc.baseline)}점${sc.baselineLabel ? ` (${esc(sc.baselineLabel)})` : ''} · 척도 ${esc(sc.min)}~${esc(sc.max)}</p>` : '';
  const cards = survey.sections.map((s, i) => {
    const scores = scoreQuestions({ sections: [s] });
    if (!scores.length) return '';
    const a = stats.areas[s.id];
    const range = scaleOf(survey);
    const base = sc.enabled ? sc.baseline : null;
    const d = a?.avg === null || a?.avg === undefined || base === null || base === undefined ? null : a.avg - base;
    return `<article class="secard" id="sec-${esc(s.id)}"${themeAttr(survey, i)}>
  <div class="sechead"><h3>${esc(s.title)}</h3>${s.subtitle ? `<p class="muted">${esc(s.subtitle)}</p>` : ''}<div class="secavg"><b>${esc(fmt1(a?.avg))}</b>${deltaChip(d)}${scoreBar({ value: a?.avg, ...range, baseline: base, title: `${s.title} 평균` })}</div></div>
  <ul class="qlist">${scores.map(({ q }) => questionRow(survey, q, stats.questions[q.id])).join('')}</ul></article>`;
  }).join('');
  return `<section id="rp-scores" class="block"><h2>점수 요약</h2>${legend}${cards}</section>`;
}

function choices(survey, { records }) {
  const cs = choiceStats(survey, records);
  const blocks = survey.sections.map((s, i) => {
    const qs = s.questions.filter((q) => cs[q.id]);
    if (!qs.length) return '';
    return `<article class="secard"${themeAttr(survey, i)}><div class="sechead"><h3>${esc(s.title)}</h3></div>${qs.map((q) => {
      const c = cs[q.id];
      return `<div class="choice" id="choice-${esc(q.id)}" data-q="${esc(q.id)}"><h4>${esc(q.prompt)} <span class="muted">${c.multi ? '복수선택' : '단일선택'} · 응답 ${c.answered}명</span></h4><ul class="dist">${c.options.map((o) => `<li data-option="${esc(o.option)}"><span class="olabel">${esc(o.option)}</span>${scoreBar({ value: o.pct ?? 0, min: 0, max: 100, cls: 'dist-bar', title: `${o.option} ${o.count}명` })}<span class="ocount"><b>${o.count}</b> <span class="muted">${o.pct === null ? '-' : `${fmt1(o.pct)}%`}</span></span></li>`).join('')}${c.other ? `<li class="muted"><span class="olabel">기타 값</span><span></span><span class="ocount"><b>${c.other}</b></span></li>` : ''}</ul></div>`;
    }).join('')}</article>`;
  }).join('');
  return blocks ? `<section id="rp-choices" class="block"><h2>선택형 문항</h2>${blocks}</section>` : '';
}

function groups(survey, { stats }) {
  const gs = stats.categories.filter((c) => stats.nByCategory[c] > 0);
  if (gs.length < 2) return '';
  const sc = survey.scale ?? {}, range = scaleOf(survey), base = sc.enabled ? sc.baseline : null;
  const cell = (avg, b, title) => `<td class="num cmpcell"><b>${esc(fmt1(avg))}</b>${avg === null || avg === undefined ? '' : scoreBar({ value: avg, ...range, baseline: b ?? base, cls: 'mini', title })}</td>`;
  const rows = [`<tr class="all"><th scope="row">종합</th>${gs.map((c) => cell(stats.overallByCategory[c], base, `${c} 종합`)).join('')}</tr>`];
  survey.sections.forEach((s, i) => {
    const a = stats.areas[s.id];
    if (!a) return;
    rows.push(`<tr class="area"${themeAttr(survey, i)} data-area="${esc(s.id)}"><th scope="row">${esc(s.title)}</th>${gs.map((c) => cell(a.byCategory[c], base, `${c} ${s.title}`)).join('')}</tr>`);
    for (const { q } of scoreQuestions({ sections: [s] })) {
      const st = stats.questions[q.id];
      rows.push(`<tr class="qcmp" data-q="${esc(q.id)}"><th scope="row"><span class="qid">${esc(q.id)}</span> ${esc(label(q))}</th>${gs.map((c) => cell(st.byCategory[c].avg, st.baseline, `${c} ${q.prompt}`)).join('')}</tr>`);
    }
  });
  return `<section id="rp-groups" class="block"><h2>참여 구분별 비교</h2><p class="muted">응답이 없는 구분은 표시하지 않습니다. 막대의 세로선은 기준점입니다.</p><div class="scroll"><table id="tbl-compare" class="cmp"><thead><tr><th>항목</th>${gs.map((c) => `<th class="num" data-group="${esc(c)}">${esc(c)}<br><span class="muted">n=${stats.nByCategory[c]}</span></th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div></section>`;
}

function chip(cls, text) { return `<span class="chip ${cls}">${esc(text)}</span>`; }

function comments(survey, { records }) {
  const byId = new Map(survey.sections.flatMap((s) => s.questions).map((x) => [x.id, x]));
  const blocks = survey.sections.map((s, i) => {
    const qs = s.questions.filter((q) => q.type === 'text');
    if (!qs.length) return '';
    return qs.map((q) => {
      const items = records.filter((r) => typeof r.answers[q.id] === 'string' && r.answers[q.id].trim());
      return `<article class="cmq" id="cmt-${esc(q.id)}" data-q="${esc(q.id)}"${themeAttr(survey, i)}><h3><span class="muted">${esc(s.title)}</span> ${esc(q.prompt)} <span class="count">${items.length}건</span></h3>${items.length ? `<ul class="comments">${items.map((r) => {
        const linked = (q.linkedScores ?? []).filter((id) => byId.has(id)).map((id) => {
          const tok = scoreToken(r.answers[id]);
          return chip(tok === '평가안함' ? 'na' : tok === '-' ? 'none' : 'score', `${label(byId.get(id))} ${tok}`);
        });
        return `<li class="cm"><div class="cm-meta">${chip('cat', r.category || '구분 없음')}${linked.join('')}</div><p class="cm-text">${esc(r.answers[q.id].trim())}</p></li>`;
      }).join('')}</ul>` : '<p class="muted">응답 없음</p>'}</article>`;
    }).join('');
  }).join('');
  return blocks ? `<section id="rp-comments" class="block"><h2>주관식 의견</h2>${blocks}</section>` : '';
}

/** @param {{survey:object, all:object[], records:object[], duplicates:object[], stats:object}} m */
export function renderDashboard(m) {
  const { survey } = m;
  return [header(survey, m), kpis(survey, m), sections(survey, m), choices(survey, m), groups(survey, m), comments(survey, m)].join('\n');
}
