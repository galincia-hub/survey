// Dummy memo -> intake -> validate -> deploy dry-run bundle -> subpath serve -> browser submit (worker adapter, mock collector)
// -> report XLSX re-read -> distribute QR + kakao. Everything lives in a temp root; real surveys/ is only read.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
import {startMock} from '../tools/mock-collector.mjs';
import {intake} from '../tools/intake.mjs';
import {verifyBundle} from '../tools/deploy.mjs';
import {browser} from './browser.mjs';
import {until} from './cdp.mjs';
const repo=new URL('../',import.meta.url).pathname;
const temp=await mkdtemp(path.join(tmpdir(),'sf-intake-e2e-'));
const id='demo-event-001',prefix='/MD-e2e',collectorPort=18806,webPort=18807;
const secret=randomUUID(),admin=randomUUID();
const memo=`행사: 테스트 워크숍
행사일: 2026-11-03
대상: 참가자
목적: 워크숍 운영 개선을 위한 의견을 듣습니다.
비교기준: 지난 워크숍 = 10점
마감일: 2099-12-31
참여구분: 운영진, 참가자
발신자: 테스트팀
질문:
## 운영
- 진행 방식
- 시간 배분
- 운영에 대한 의견 (주관식)
## 콘텐츠
- 발표 내용
`;
const cli=(script,args)=>{const r=spawnSync(process.execPath,[path.join(repo,script),...args],{cwd:repo,encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;};
const snapshot=async dir=>{const out={};for(const e of await readdir(dir,{withFileTypes:true,recursive:true}))if(e.isFile()){const f=path.join(e.parentPath??e.path,e.name);out[path.relative(dir,f)]=createHash('sha256').update(await readFile(f)).digest('hex');}return out;};
let mock,web,b,passed=0;
async function step(name,fn){await fn();passed++;console.log('PASS '+name);}
try{
  const realBefore=await snapshot(path.join(repo,'surveys'));
  const memoPath=path.join(temp,'memo.txt'),surveysDir=path.join(temp,'surveys');
  await writeFile(memoPath,memo);await mkdir(surveysDir);
  let survey,plan,envelope;
  await step('intake scaffolds a new survey, never overwrites existing ones',async()=>{
    const r=intake({memoPath,id,surveysDir,today:'2026-10-02'});
    assert.deepEqual(r.todos.filter(t=>!/참여구분|발신자/.test(t)),[]);
    survey=JSON.parse(await readFile(r.out));assert.equal(survey.surveyId,id);
    assert.throws(()=>intake({memoPath,id,surveysDir}),/refusing to overwrite/);
    for(const existing of await readdir(path.join(repo,'surveys')))assert.throws(()=>intake({memoPath,id:existing,surveysDir:path.join(repo,'surveys')}),/refusing to overwrite|surveyId/);
  });
  await step('validate passes; owner points the content at a worker collector',async()=>{
    const file=path.join(surveysDir,id,'survey.json');
    cli('tools/validate.mjs',[file]);
    survey.collector={adapter:'worker',endpoint:`http://127.0.0.1:${collectorPort}`};
    await writeFile(file,JSON.stringify(survey,null,2));cli('tools/validate.mjs',[file]);
  });
  await step('deploy --dry-run builds a frozen bundle in the temp root only',async()=>{
    plan=JSON.parse(cli('tools/deploy.mjs',[id,'--root',temp,'--target','github-pages','--dry-run','--base-url',`http://127.0.0.1:${webPort}${prefix}`]));
    assert.equal(plan.mode,'dry-run');assert.ok(plan.directory.startsWith(temp));await verifyBundle(plan.directory);
    assert.ok(!plan.files.some(f=>f.includes('prompt')),'prompt file must not ship');
  });
  await step('bundle served under a subpath: browser submit via worker adapter reaches the mock collector',async()=>{
    mock=await startMock({port:collectorPort,env:{REPORT_SECRET:secret,ADMIN_SECRET:admin,ALLOWED_ORIGINS:`http://127.0.0.1:${webPort}`}});
    const reg=await fetch(plan.registry.url,{method:'PUT',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:JSON.stringify({version:survey.version,deadline:survey.deadline,status:'open'})});assert.equal(reg.status,200);
    web=spawn(process.execPath,['tools/preview.mjs'],{cwd:repo,env:{...process.env,PREVIEW_PORT:String(webPort),COLLECTOR_PORT:String(collectorPort),BUNDLE_ROOT:plan.directory,BUNDLE_PREFIX:prefix},stdio:'ignore',detached:true});
    await until(async()=>{if(web.exitCode!==null)throw new Error('bundle preview failed');try{return (await fetch(plan.url)).ok;}catch{return false;}},'bundle preview');
    b=await browser();await b.navigate(plan.url);await b.wait(`!!document.querySelector('.intro-affiliation')`);
    await b.evaluate(`document.querySelector('#aff_0').click();document.querySelector('[data-action="start"]').click()`);await b.wait(`!!document.querySelector('.score-slider')`);
    await b.evaluate(`document.querySelectorAll('.score-slider').forEach((el,i)=>{el.value=[14,8,12][i];el.dispatchEvent(new Event('input',{bubbles:true}));});document.querySelectorAll('textarea').forEach(el=>{el.value='  e2e 의견  ';el.dispatchEvent(new Event('input',{bubbles:true}));});document.querySelector('[data-action="submit"]').click()`);
    await b.wait(`!!document.querySelector('.done')||!!document.querySelector('#surveyErr')?.textContent`);
    assert.equal(await b.evaluate(`!!document.querySelector('.done')`),true,await b.evaluate(`document.querySelector('#surveyErr')?.textContent||''`));
    const read=await fetch(`http://127.0.0.1:${collectorPort}/v1/responses/${id}`,{headers:{Authorization:'Bearer '+secret}});
    const records=(await read.json()).responses;assert.equal(records.length,1);envelope=records[0];
    const payload=JSON.parse(envelope.raw);assert.equal(payload.surveyId,id);assert.equal(payload.respondentCategory,'운영진');
    assert.deepEqual([payload.answers.Q01,payload.answers.Q02,payload.answers.Q04],[14,8,12]);
    assert.ok(Object.values(payload.answers).includes('e2e 의견'));
    assert.deepEqual(b.blocked,[]);assert.deepEqual(b.errors,[]);
  });
  await step('report CLI -> XLSX re-read matches the submitted answers',async()=>{
    const jsonl=path.join(temp,'responses.jsonl');await writeFile(jsonl,JSON.stringify(envelope)+'\n');
    cli('tools/report.mjs',[path.join(surveysDir,id,'survey.json'),'--source','jsonl',jsonl,'--out',path.join(temp,'reports')]);
    const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(temp,'reports',id+'-report.xlsx'));
    assert.ok(wb.worksheets.map(s=>s.name).includes('summary'));
    assert.equal(wb.getWorksheet('raw').getCell('I2').value,envelope.raw);
    const questions=wb.getWorksheet('questions').getSheetValues().slice(2).map(r=>r.slice(1));
    assert.ok(questions.some(r=>r[0]==='Q01'),'Q01 row present');
    assert.match(await readFile(path.join(temp,'reports/report.txt'),'utf8'),/e2e 의견/);
  });
  await step('distribute CLI -> QR decodes the subpath URL; kakao.txt carries it',async()=>{
    cli('tools/distribute.mjs',[path.join(surveysDir,id,'survey.json'),'--base-url',`http://127.0.0.1:${webPort}${prefix}`,'--out',plan.directory]);
    const png=PNG.sync.read(await readFile(path.join(plan.directory,'qr.png')));
    assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height).data,plan.url);
    assert.ok((await readFile(path.join(plan.directory,'kakao.txt'),'utf8')).includes(plan.url));
    await verifyBundle(plan.directory);
  });
  await step('real surveys/ untouched',async()=>assert.deepEqual(await snapshot(path.join(repo,'surveys')),realBefore));
  console.log(`PASS ${passed} intake-to-report e2e checks`);
}catch(e){console.error(e.stack);process.exitCode=1;}
finally{
  await b?.close();
  if(web&&web.exitCode===null){const done=new Promise(r=>web.once('exit',r));web.kill('SIGTERM');await done;}
  await mock?.close();await rm(temp,{recursive:true,force:true});
}
