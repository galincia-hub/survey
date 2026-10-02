import {submitResponse} from './storage.js';
const app = document.getElementById("app");
const progressBar = document.getElementById("progressBar");

const params = new URLSearchParams(location.search);
const refCode = (params.get("ref") || "").trim().toUpperCase();
let bank, questions;
let page = "intro";
const answers = {};
let affiliation = "";
const NOT_EVALUATED = "NA";

function esc(s=""){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

async function boot(){
  const response = await fetch(`./survey.json`,{cache:'no-store'});
  if (!response.ok) throw new Error('Content unavailable');
  bank = await response.json();
  questions = bank.sections.flatMap(section=>section.questions);
  document.title=bank.title;
  document.querySelector('.brand').textContent=bank.intro.brand;
  document.documentElement.dataset.theme=bank.theme;
  if (Date.now()>Date.parse(bank.deadline)) return showClosed();
  render();
}

function setProgress(){
  progressBar.style.width = page === "intro" ? "50%" : "100%";
}

function render(){
  setProgress();
  if(page === "intro") renderIntro();
  else renderSurvey();
  scrollTo({top:0,behavior:"smooth"});
}

function renderIntro(){
  app.innerHTML = `
    <div class="eyebrow">${esc(bank.intro.eyebrow)}</div>
    <h1>${esc(bank.title)}</h1>

    <div class="intro-copy">
      ${bank.intro.paragraphs.map((text,i)=>`<p class="${i===bank.intro.emphasisParagraph?'intro-emphasis':''}">${bank.intro.highlightText && i===bank.intro.emphasisParagraph ? esc(text).replace(esc(bank.intro.highlightText),`<span class="intro-highlight">${esc(bank.intro.highlightText)}</span>`) : esc(text)}</p>`).join('')}
    </div>

    <div class="field intro-affiliation">
      <div class="q required">${esc(bank.respondent.label)}</div>${bank.respondent.help?`<div class="qhelp">${esc(bank.respondent.help)}</div>`:""}
      <div class="options affiliation-grid">
        ${bank.respondent.options.map((x,i)=>`<div class="option"><input type="radio" id="aff_${i}" name="aff" value="${esc(x)}" ${affiliation===x?"checked":""}><label for="aff_${i}">${esc(x)}</label></div>`).join("")}
      </div>
      <div id="introErr" class="error"></div>
    </div>

    <div class="note">${esc(bank.distribution.deadlineText)}</div>
    <div class="actions"><button class="primary" onclick="nextIntro()">설문 시작하기</button></div>`;
}

function nextIntro(){
  const checked = document.querySelector('input[name="aff"]:checked');
  if(!checked){
    document.getElementById("introErr").textContent="참여 구분을 선택해주세요.";
    return;
  }
  affiliation = checked.value;
  page = "survey";
  render();
}

function renderSurvey(){
  const guide = bank.scale;
  const sections = bank.sections.map(meta => {
    const area = meta.id;
    const qs = meta.questions;
    return `
      <section class="survey-section" id="area_${area}" data-theme="${meta.theme}">
        <div class="section-head">
          <h2>${esc(meta.title)}</h2>
          <p>${esc(meta.subtitle || "")}</p>
        </div>
        ${qs.map(renderQuestion).join("")}
      </section>`;
  }).join("");

  app.innerHTML = `
    <div class="eyebrow">${esc(bank.page.eyebrow)}</div>
    <h1>${esc(bank.page.title)}</h1>
    <p class="lead">${esc(bank.page.lead)}</p>

    <div class="score-guide score-guide-main">
      <b>${esc(guide.baselineLabel)}</b>
      <span>${esc(guide.lowLabel)} · ${esc(guide.sameLabel)} · ${esc(guide.highLabel)}</span>
    </div>

    <div id="surveyQuestions">${sections}</div>
    <div id="surveyErr" class="error survey-error"></div>
    <div class="actions survey-actions">
      <button class="secondary" onclick="backToIntro()">이전</button>
      <button class="primary" onclick="submitFromSurvey()">제출하기</button>
    </div>`;
}

function renderQuestion(q){
  q = {...bank.scale, ...q};
  const req = q.required ? " required" : "";
  let body="";

  if(q.type==="score"){
    const saved = answers[q.id];
    const isNA = saved === NOT_EVALUATED;
    const hasNumeric = saved !== undefined && saved !== "" && !isNA && Number.isFinite(Number(saved));
    const current = hasNumeric ? Number(saved) : Number(q.baseline);
    const readout = isNA ? "N/A" : (hasNumeric ? current : "-");
    body=`<div class="score20 compact-score" data-score-wrap="${q.id}">
      <div class="score-readout"><span>선택 점수</span><strong id="score_${q.id}" class="${isNA?"na-readout":""}">${readout}</strong><em>/ ${q.max}</em></div>
      <input aria-label="${esc(q.prompt)}" class="score-slider" type="range" min="${q.min}" max="${q.max}" step="1" value="${current}" data-qid="${q.id}" data-selected="${isNA?NOT_EVALUATED:(hasNumeric?current:"")}" oninput="selectScore('${q.id}', this.value)">
      <div class="score-axis"><span>${q.min}</span><span class="baseline" style="position:relative;left:${((q.baseline-q.min)/(q.max-q.min)-0.5)*100}%">${q.baseline}<small>${esc(bank.scale.baselineName)}</small></span><span>${q.max}</span></div>
      <div class="score-choice-row">
        <span class="score-move-hint">점수 배정을 위해서는 슬라이드를 움직여주세요.</span>
        ${bank.scale.allowNotEvaluated?`<button type="button" id="na_${q.id}" class="unable-btn ${isNA?"selected":""}" onclick="selectUnable('${q.id}')">평가하기 어려움 <span>(경험하지 못함)</span></button>`:""}
      </div>
    </div>`;
  } else if (q.type.endsWith('Choice')) {
    body='<div class="options">'+q.options.map((option,i)=>`<div class="option"><input type="${q.type==='multiChoice'?'checkbox':'radio'}" name="${q.id}" id="${q.id}_${i}" value="${esc(option)}" ${(Array.isArray(answers[q.id])?answers[q.id]:[answers[q.id]]).includes(option)?'checked':''}><label for="${q.id}_${i}">${esc(option)}</label></div>`).join('')+'</div>';
  } else {
    const TEXT_MAX=q.maxLength ?? 1000;
    const savedText = String(answers[q.id] || "").slice(0, TEXT_MAX);
    body=`<textarea aria-label="${esc(q.prompt)}" name="${q.id}" rows="${q.rows||4}" maxlength="${TEXT_MAX}" placeholder="자유롭게 적어주세요." oninput="updateTextCount('${q.id}', this)">${esc(savedText)}</textarea>${q.required?`<div class="text-required-note">답변을 해주셔야만 설문을 완성할 수 있습니다.</div>`:""}
      <div class="char-count" id="count_${q.id}">최대 ${TEXT_MAX.toLocaleString()}자 · 현재 ${savedText.length.toLocaleString()}/${TEXT_MAX.toLocaleString()}</div>`;
  }

  return `<div class="field question-card" data-qid="${q.id}">
    <div class="q${req}">${esc(q.prompt)}</div>
    ${q.help?`<div class="qhelp">${esc(q.help)}</div>`:""}
    ${body}
    <div class="error" id="err_${q.id}"></div>
  </div>`;
}

function updateTextCount(id, el){
  const count = document.getElementById(`count_${id}`);
  if(!count) return;
  const TEXT_MAX=questions.find(q=>q.id===id).maxLength ?? 1000;
  el.value=el.value.slice(0,TEXT_MAX);
  answers[id]=el.value;
  const len = el.value.length;
  count.textContent = `최대 ${TEXT_MAX.toLocaleString()}자 · 현재 ${len.toLocaleString()}/${TEXT_MAX.toLocaleString()}`;
  count.classList.toggle("near-limit", len >= TEXT_MAX * 0.9);
}

function selectScore(id, value){
  const el=document.querySelector(`.score-slider[data-qid="${id}"]`);
  if(!el) return;
  const n=Number(value);
  el.dataset.selected=String(n);
  el.value=String(n);
  const out=document.getElementById(`score_${id}`);
  if(out){
    out.textContent=String(n);
    out.classList.remove("na-readout");
  }
  answers[id]=n;
  document.getElementById(`baseline_${id}`)?.classList.toggle("selected", n===(questions.find(q=>q.id===id).baseline ?? bank.scale.baseline));
  document.getElementById(`na_${id}`)?.classList.remove("selected");
  const err=document.getElementById(`err_${id}`);
  if(err) err.textContent="";
}

function selectUnable(id){
  const el=document.querySelector(`.score-slider[data-qid="${id}"]`);
  if(!el) return;
  el.dataset.selected=NOT_EVALUATED;
  answers[id]=NOT_EVALUATED;
  const out=document.getElementById(`score_${id}`);
  if(out){
    out.textContent="N/A";
    out.classList.add("na-readout");
  }
  document.getElementById(`baseline_${id}`)?.classList.remove("selected");
  document.getElementById(`na_${id}`)?.classList.add("selected");
  const err=document.getElementById(`err_${id}`);
  if(err) err.textContent="";
}

function collectSurvey(showErrors=true){
  let valid=true;
  let firstInvalid=null;

  questions.forEach(q=>{
    let val;
    if(q.type==="score"){
      const el=document.querySelector(`.score-slider[data-qid="${q.id}"]`);
      val=el?.dataset.selected ?? "";
      if(val!=="" && val!==NOT_EVALUATED) val=Number(val);
    } else if (q.type.endsWith('Choice')) {
      const selected=[...document.querySelectorAll(`[name="${q.id}"]:checked`)].map(el=>el.value);
      val=q.type==='multiChoice'?selected:(selected[0]||'');
    } else {
      const TEXT_MAX=q.maxLength ?? 1000;
      val=document.querySelector(`[name="${q.id}"]`)?.value.trim() || "";
      if(val.length > TEXT_MAX) val = val.slice(0, TEXT_MAX);
    }

    answers[q.id]=val;
    const empty = val === "" || val === null || val === undefined || (typeof val==="string" && !val.trim()) || (Array.isArray(val) && !val.length);
    const err=document.getElementById(`err_${q.id}`);
    if(err) err.textContent="";

    if(q.required && empty){
      valid=false;
      if(showErrors && err) err.textContent=q.type==="text"?"답변을 해주셔야만 설문을 완성할 수 있습니다.":"이 문항에 답해주세요.";
      if(!firstInvalid) firstInvalid=document.querySelector(`[data-qid="${q.id}"]`);
    }
  });

  if(!valid && showErrors && firstInvalid){
    firstInvalid.scrollIntoView({behavior:"smooth",block:"center"});
  }
  return valid;
}

function backToIntro(){
  collectSurvey(false);
  page="intro";
  render();
}

function submitFromSurvey(){
  if(!collectSurvey(true)){
    document.getElementById("surveyErr").textContent="필수 문항을 확인해주세요.";
    return;
  }
  document.getElementById("surveyErr").textContent="";
  submitSurvey();
}

async function submitSurvey(){
  if (Date.now()>Date.parse(bank.deadline)) return showClosed();
  const btn=document.querySelector('.survey-actions .primary');
  if(btn.disabled) return;
  btn.disabled=true; btn.textContent='제출 중…';
  try {
    await submitResponse(bank, affiliation, answers, refCode);
    progressBar.style.width='100%';
    app.innerHTML=`<div class="done"><div class="mark">✓</div><h2>감사합니다.</h2><p class="lead">${esc(bank.page.done)}</p></div>`;
  } catch(error) {
    btn.disabled=false; btn.textContent='다시 제출하기';
    document.getElementById('surveyErr').textContent='응답 저장에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 눌러주세요.';
  }
}
function showClosed(){app.innerHTML='<div class="done"><h2>응답이 마감되었습니다.</h2></div>';}
Object.assign(window,{nextIntro,backToIntro,submitFromSurvey,selectScore,selectUnable,updateTextCount});
boot().catch(()=>{app.textContent='설문을 불러오지 못했습니다. 잠시 후 다시 접속해주세요.';});
