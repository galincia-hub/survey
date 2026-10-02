import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {validate} from '../tools/validate.mjs';
import {makePayload,submitResponse} from '../engine/storage.js';
import {convert} from '../tools/convert-reference.mjs';
const read=p=>readFile(new URL(p,import.meta.url)).then(JSON.parse);
const sample=await read('../surveys/sample-survey/survey.json');
const reference=await read('../surveys/adora-ship-visit-001/survey.json');
let count=0;
function check(label,fn){fn();count++;console.log('PASS '+label);}
check('Both valid survey contents',()=>{assert.deepEqual(validate(sample),[]);assert.deepEqual(validate(reference),[]);});
for(const [label,mutate] of [
 ['unlisted identity despite global permission',s=>{s.privacy.allowIdentity=true;s.privacy.identityQuestions=['Q01'];s.sections[0].questions[1].prompt='성함';}],['unknown property',s=>s.surprise=true],['missing title',s=>delete s.title],['duplicate question',s=>s.sections[0].questions[1].id='Q01'],['duplicate section',s=>s.sections.push(structuredClone(s.sections[0]))],['invalid link',s=>s.sections[0].questions[1].linkedScores=['missing']],['non-score link',s=>s.sections[0].questions[1].linkedScores=['Q03']],['invalid bounds',s=>s.scale.min=s.scale.baseline],['invalid question bounds',s=>s.sections[0].questions[0].max=1],['invalid ISO date',s=>s.eventDate='2026-02-30'],['invalid deadline',s=>s.deadline='2026-10-02'],['invalid deadline time',s=>s.deadline='2026-10-02T25:00:00Z'],['forbidden term',s=>s.title=String.fromCodePoint(0xc775,0xba85)],['identity prompt',s=>s.sections[0].questions[1].prompt='성함을 남겨주세요'],['identity metadata',s=>s.sections[0].questions[1].identity=true],['choice options',s=>delete s.sections[0].questions[2].options],['remote endpoint',s=>s.collector.endpoint='https://example.com/submit'],['bad max length',s=>s.sections[0].questions[1].maxLength=0],['unsupported question',s=>s.sections[0].questions[1].type='html']
])check('Validator rejects '+label,()=>{const copy=structuredClone(sample);mutate(copy);assert.ok(validate(copy).length);});
check('CLI nonzero on invalid document',()=>assert.notEqual(spawnSync(process.execPath,['tools/validate.mjs','package.json']).status,0));
check('Legacy payload compatibility and ref default',()=>{
 const p=makePayload(reference,'category',{a:'NA',b:0,c:'  raw  '},'');assert.equal(p.ref,'');assert.equal(p.answers.b,0);assert.equal(p.answers.a,'NA');assert.equal(p.answers.c,'  raw  ');assert.ok(!('surveyId' in p));
});
check('Standard payload mapping',()=>assert.equal(makePayload(sample,'category',{},'abc').respondentCategory,'category'));
check('Converter preserves question text, id, order, fields and links',()=>{
 const bank={meta:{title:'Example',eventDate:'2026-10-02',areas:{s:{title:'Example',subtitle:''}},scoreGuide:{min:0,max:20,baseline:10}},C:[{id:'A',area:'s',type:'score20',required:true,prompt:'Score'},{id:'B',area:'s',type:'text',required:false,prompt:'Text'}]};
 const c=convert(bank,{...sample,payload:{format:'legacy',surveyType:'C'},conversion:{allTextRequired:true}});
 assert.deepEqual(c.sections[0].questions.map(q=>q.prompt),['Score','Text']);assert.equal(c.sections[0].questions[1].required,true);assert.deepEqual(c.sections[0].questions[1].linkedScores,['A']);
});
globalThis.location={hostname:'127.0.0.1'};
let calls=0;globalThis.fetch=()=>{calls++;throw new Error('Should not fetch');};
await assert.rejects(()=>submitResponse({...sample,collector:{adapter:'local-mock',endpoint:'https://example.com/submit'}},'',{},''));
globalThis.location.hostname='public.example';await assert.rejects(()=>submitResponse(sample,'',{},''));assert.equal(calls,0);console.log('PASS storage refuses remote targets and public origins');
console.log(`PASS ${count+1} validation/storage checks`);

const css=await readFile(new URL('../engine/styles.css',import.meta.url),'utf8');assert.doesNotMatch(css,/var\(--[^)]+\)[a-f0-9]+/i);console.log('PASS no malformed color token suffix');
const source=await read('../surveys/adora-ship-visit-001/source/questions.json');
const presentation=await read('../surveys/adora-ship-visit-001/source/reference-presentation.json');
assert.deepEqual(convert(source,presentation),reference);
for(const [i,q] of reference.sections.flatMap(s=>s.questions).entries()){
  const original=source.C[i];
  for(const key of ['id','prompt','help','rows'])assert.equal(q[key],original[key]);
  assert.equal(q.required,original.type==='text'?true:original.required);
}
console.log('PASS real reference content parity and reproducible conversion');
const golden=await read('./fixtures/legacy-payload.json');
assert.equal(JSON.stringify(makePayload(reference,golden.affiliation,golden.answers,'',new Date(golden.submittedAt))),JSON.stringify(golden));
assert.equal(makePayload(sample,'category',{},'').ref,'미지정');
console.log('PASS live-logic golden legacy payload bytes and standard ref fallback');
