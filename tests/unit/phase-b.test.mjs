import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validate,validateFile,checkSchema} from '../../tools/validate.mjs';
import {submitResponse,SurveyClosedError,fetchWithTimeout,isPreviewHost} from '../../engine/storage.js';
const sample=JSON.parse(await readFile(new URL('../../surveys/sample-survey/survey.json',import.meta.url)));
test('schema supports max constraints and unconstrained arrays; dates ordered and identity match clear',()=>{
  assert.ok(checkSchema(9,{type:'number',maximum:8}).length);
  assert.ok(checkSchema('long',{type:'string',maxLength:2}).length);
  assert.deepEqual(checkSchema([1,'x'],{type:'array'}),[]);
  const s=structuredClone(sample);s.deadline=s.eventDate+'T00:00:00Z';assert.match(validate(s).join(),/deadline/);
  s.sections[0].questions[1].prompt='성함';assert.match(validate(s).join(),/성함/);
});
test('validator CLI/file gate checks containing surveyId folder',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sf-validation-'));
  try{await mkdir(path.join(root,'wrong'));const file=path.join(root,'wrong/survey.json');await writeFile(file,JSON.stringify(sample));await assert.rejects(validateFile(file),/folder/);}finally{await rm(root,{recursive:true,force:true});}
});
test('worker adapter URL, idempotency header, raw shape, closed error; form gate blocks all local/preview origins',async()=>{
  const oldFetch=globalThis.fetch,oldLocation=globalThis.location;let calls=[];
  try{
    globalThis.location={protocol:'http:',hostname:'127.0.0.1'};
    globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return new Response('{"ok":true,"id":"test"}',{status:201});};
    const content={...sample,collector:{adapter:'worker',endpoint:'http://127.0.0.1:18802'}};
    await submitResponse(content,'category',{Q01:9},'',{submissionId:'same-id'});
    assert.equal(calls[0].url,'http://127.0.0.1:18802/v1/submit/sample-survey');assert.equal(calls[0].options.headers['X-Submission-Id'],'same-id');assert.equal(JSON.parse(calls[0].options.body).surveyId,'sample-survey');
    globalThis.fetch=async()=>new Response('{"ok":false,"error":"survey_closed"}',{status:410});
    await assert.rejects(submitResponse(content,'',{},''),SurveyClosedError);
    let sends=0;globalThis.fetch=async()=>{sends++;return new Response('{}');};
    const form={...sample,collector:{adapter:'google-form',endpoint:'https://docs.google.com/forms/d/e/TEST_ONLY/formResponse',entry:'entry.1',allowedHosts:['localhost','127.0.0.1','preview.pages.dev','preview.vercel.app','approved.example']}};
    for(const [hostname,protocol] of [['localhost','http:'],['127.0.0.1','http:'],['preview.pages.dev','https:'],['preview.vercel.app','https:'],['unapproved.example','https:'],['approved.example','file:']]){
      globalThis.location={hostname,protocol};await assert.rejects(submitResponse(form,'',{},''));
    }
    assert.equal(sends,0);
    globalThis.location={hostname:'approved.example',protocol:'https:'};
    let captured;globalThis.fetch=async(url,options)=>{captured=options;return {};};
    await submitResponse(form,'category',{},'');assert.equal(captured.mode,'no-cors');assert.equal(captured.redirect,'follow');assert.ok(new URLSearchParams(captured.body).has('entry.1'));
  }finally{globalThis.fetch=oldFetch;globalThis.location=oldLocation;}
});
test('timeout uses AbortController without AbortSignal.timeout',async()=>{
  const oldFetch=globalThis.fetch,old=AbortSignal.timeout;
  try{AbortSignal.timeout=undefined;globalThis.fetch=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));await assert.rejects(fetchWithTimeout('http://127.0.0.1:18802',{},5),/aborted/);}finally{AbortSignal.timeout=old;globalThis.fetch=oldFetch;}
});

test('worker adapter: production <project>.pages.dev may submit; preview/branch pages.dev and vercel hosts and http stay blocked',async()=>{
  assert.deepEqual(['sf.pages.dev','my-project.pages.dev','example.org','galincia-hub.github.io'].map(isPreviewHost),[false,false,false,false]);
  assert.deepEqual(['abc123.sf.pages.dev','feature-x.sf.pages.dev','a.b.sf.pages.dev','sf.vercel.app','sf-git-main-team.vercel.app'].map(isPreviewHost),[true,true,true,true,true]);
  const oldFetch=globalThis.fetch,oldLocation=globalThis.location;let sends=0;
  try{
    globalThis.fetch=async()=>{sends++;return new Response('{"ok":true,"id":"t"}',{status:201});};
    const content={...sample,collector:{adapter:'worker',endpoint:'https://collector.example.workers.dev'}};
    globalThis.location={protocol:'https:',hostname:'sf.pages.dev'};
    await submitResponse(content,'c',{Q01:1},'');assert.equal(sends,1);
    for(const hostname of ['abc123.sf.pages.dev','sf.vercel.app','x.y.sf.pages.dev']){globalThis.location={protocol:'https:',hostname};await assert.rejects(submitResponse(content,'c',{},''),/disabled/);}
    globalThis.location={protocol:'http:',hostname:'sf.pages.dev'};await assert.rejects(submitResponse(content,'c',{},''),/disabled/);
    assert.equal(sends,1);
  }finally{globalThis.fetch=oldFetch;globalThis.location=oldLocation;}
});
