import { normalizeResponse, dedupeLatest, markLate } from '../lib/normalize.mjs';
import { computeStats, scoreQuestions } from '../lib/stats.mjs';
import { buildCopyText } from '../lib/copytext.mjs';
import { buildAiPrompt } from '../lib/prompt.mjs';
import { linkedPrefix, fmt1, fmtDelta } from '../lib/format.mjs';
import { parseGformCsv, parseJsonl } from '../lib/sources.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const SECRET_KEY = 'sf-report-secret'; // sessionStorage only (cleared with the tab)
const params = new URLSearchParams(location.search);
let S = null;

const store = {
  get() { try { return sessionStorage.getItem(SECRET_KEY) ?? ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem(SECRET_KEY, v); } catch { /* ignore */ } },
};
const status = (msg, err = false) => { $('status').textContent = msg; $('status').className = err ? 'err' : 'muted'; };

function surveyUrlFrom(v) {
  v = v.trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ? `../surveys/${v}/survey.json` : v;
}

async function loadRecords(survey) {
  if ($('source').value === 'file') {
    const f = $('file').files[0];
    if (!f) throw new Error('파일을 선택해주세요.');
    const text = await f.text();
    return $('file-kind').value === 'jsonl' ? parseJsonl(text) : parseGformCsv(text, { surveyId: survey.surveyId });
  }
  const endpoint = $('endpoint').value.trim().replace(/\/+$/, '');
  const secret = $('secret').value;
  if (!endpoint || !secret) throw new Error('collector 주소와 비밀번호를 입력해주세요.');
  store.set(secret);
  const res = await fetch(`${endpoint}/v1/responses/${encodeURIComponent(survey.surveyId)}`, { headers: { Authorization: `Bearer ${secret}` } });
  if (res.status === 401) throw new Error('비밀번호가 올바르지 않습니다.');
  if (!res.ok) throw new Error(`불러오기 실패 (HTTP ${res.status})`);
  const body = await res.json();
  return body.responses.map((e) => normalizeResponse(e.raw, { id: e.id, surveyId: e.surveyId, receivedAt: e.receivedAt }));
}

async function load() {
  try {
    status('불러오는 중…');
    const sres = await fetch(surveyUrlFrom($('survey-url').value));
    if (!sres.ok) throw new Error(`survey.json을 불러오지 못했습니다 (HTTP ${sres.status})`);
    const survey = await sres.json();
    const all = await loadRecords(survey);
    const { records, duplicates } = dedupeLatest(all);
    const stats = computeStats(survey, records);
    S = { survey, all, records, duplicates, stats };
    render();
    status(`응답 ${all.length}건 불러옴 (집계 ${records.length}, 중복 ${duplicates.length})`);
  } catch (e) {
    status(e.message, true);
  }
}

const cellVal = (v) => (v === undefined || v === null || v === '' ? '' : Array.isArray(v) ? v.join(', ') : String(v));

function render() {
  const { survey, all, records, duplicates, stats } = S;
  document.title = `${survey.title} · 설문 리포트`;
  $('title').textContent = `${survey.title} · 설문 리포트`;
  $('report').hidden = false;
  const qs = survey.sections.flatMap((s) => s.questions);
  const dupSet = new Set(duplicates);
  markLate(all, survey.deadline);
  const lateAll = all.filter((r) => r.late).length, lateCounted = records.filter((r) => r.late).length;

  // A. responses
  $('view-a').innerHTML = `<h2>A. 응답 (${all.length}건)</h2><div class="scroll"><table id="tbl-responses"><thead><tr>
    <th>ref</th><th>구분</th><th>제출</th><th>수신</th><th>상태</th><th>마감후</th>${qs.map((q) => `<th title="${esc(q.prompt)}">${esc(q.id)}</th>`).join('')}</tr></thead><tbody>
    ${all.map((r) => `<tr class="${dupSet.has(r) ? 'dup' : ''}${r.late ? ' late' : ''}" data-late="${r.late}"><td>${esc(r.ref)}</td><td>${esc(r.category)}</td><td>${esc(r.submittedAt)}</td><td>${esc(r.receivedAt)}</td>
    <td>${dupSet.has(r) ? '중복(제외)' : '집계'}</td><td class="late-cell">${r.late ? '마감후' : ''}</td>
    ${qs.map((q) => `<td class="${q.type === 'text' ? 'text' : 'num'}" data-q="${esc(q.id)}">${esc(cellVal(r.answers[q.id]))}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;

  // B. summary
  const areaRows = Object.values(stats.areas);
  $('view-b').innerHTML = `<h2>B. 요약</h2>
    <p>총 응답수 <b id="sum-n">${stats.n}</b> (중복 제외 ${duplicates.length}건)</p>
    <p>마감 후 수신 <b id="sum-late">${lateAll}</b>건 (집계 대상 중 ${lateCounted}건) — 표시만 하며 통계에서 제외하지 않습니다.</p>
    <div class="scroll"><table id="tbl-cat"><thead><tr><th>참여 구분</th><th>응답수</th>${areaRows.map((a) => `<th>${esc(a.title)}</th>`).join('')}<th>종합</th></tr></thead><tbody>
    ${stats.categories.map((c) => `<tr><td>${esc(c)}</td><td class="num">${stats.nByCategory[c]}</td>${areaRows.map((a) => `<td class="num">${fmt1(a.byCategory[c])}</td>`).join('')}<td class="num">${fmt1(stats.overallByCategory[c])}</td></tr>`).join('')}
    <tr><th>전체</th><th class="num">${stats.n}</th>${areaRows.map((a) => `<th class="num">${fmt1(a.avg)}</th>`).join('')}<th class="num" id="sum-overall">${fmt1(stats.overall.avg)}</th></tr>
    </tbody></table></div>`;

  // C. per question
  $('view-c').innerHTML = `<h2>C. 문항별</h2><div class="scroll"><table id="tbl-questions"><thead><tr><th>ID</th><th>문항</th><th>평균</th><th>기준대비</th><th>유효</th><th>평가 어려움</th><th>미응답</th><th>최저</th><th>최고</th>
    ${stats.categories.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
    ${scoreQuestions(survey).map(({ q }) => { const st = stats.questions[q.id]; return `<tr data-q="${esc(q.id)}"><td>${esc(q.id)}</td><td>${esc(q.prompt)}</td><td class="num">${fmt1(st.avg)}</td><td class="num">${fmtDelta(st.delta)}</td><td class="num">${st.valid}</td><td class="num">${st.na}</td><td class="num">${st.unanswered}</td><td class="num">${st.min ?? '-'}</td><td class="num">${st.max ?? '-'}</td>${stats.categories.map((c) => `<td class="num">${fmt1(st.byCategory[c].avg)}</td>`).join('')}</tr>`; }).join('')}
    </tbody></table></div>`;

  // D. text with linked scores
  $('view-d').innerHTML = `<h2>D. 주관식 (관련 점수 포함)</h2>` + survey.sections.flatMap((s) => s.questions.filter((q) => q.type === 'text').map((q) => {
    const items = records.filter((r) => typeof r.answers[q.id] === 'string' && r.answers[q.id].trim());
    return `<h3>${esc(s.title)} · ${esc(q.prompt)}</h3><ul class="lines" data-q="${esc(q.id)}">${items.map((r) => `<li><span class="prefix">${esc(linkedPrefix(survey, q, r))}</span> <span class="body">${esc(r.answers[q.id].trim())}</span></li>`).join('') || '<li class="muted">응답 없음</li>'}</ul>`;
  })).join('');

  // E. copy + prompt
  $('ai-prompt').value = buildAiPrompt(survey, records, stats);
  $('copy-out').value = '';
}

async function copy(mode) {
  const text = mode === 'prompt' ? $('ai-prompt').value : buildCopyText(S.survey, S.records, mode, S.stats);
  $('copy-out').value = text;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    try { $('copy-out').select(); ok = document.execCommand('copy'); } catch { /* ignore */ }
  }
  $('copy-status').textContent = ok ? '복사되었습니다.' : '자동 복사가 막혀 있습니다. 아래 내용을 직접 선택해 복사해주세요.';
}

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== name; });
}

$('source').addEventListener('change', () => {
  const f = $('source').value === 'file';
  $('src-file').hidden = !f; $('src-collector').hidden = f;
});
$('load').addEventListener('click', load);
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('copy-all').addEventListener('click', () => copy('all'));
$('copy-scores').addEventListener('click', () => copy('scores'));
$('copy-text').addEventListener('click', () => copy('text'));
$('copy-prompt').addEventListener('click', () => copy('prompt'));

// prefill from URL (never the secret)
if (params.get('survey')) $('survey-url').value = params.get('survey');
if (params.get('collector')) $('endpoint').value = params.get('collector');
$('secret').value = store.get();
