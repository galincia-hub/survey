import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
import {startMock} from '../tools/mock-collector.mjs';
import {browser} from './browser.mjs';
import {startServers} from './servers.mjs';
import {until} from './cdp.mjs';
import {verifyBundle} from '../tools/deploy.mjs';
const root=new URL('../',import.meta.url).pathname;
const id='tmp-flow-'+randomUUID().slice(0,8),closedId=id+'-closed';
const temp=await mkdtemp(path.join(tmpdir(),'sf-flow-data-'));
const sample=JSON.parse(await readFile(new URL('../surveys/sample-survey/survey.json',import.meta.url)));
const secret=randomUUID(),admin=randomUUID();
const themes=['sage','soft-blue','warm-beige','lavender'];
const content={...sample,surveyId:id,theme:'lavender',eventDate:'2020-01-01',deadline:'2099-12-31T23:59:59+09:00',collector:{adapter:'worker',endpoint:'http://127.0.0.1:18802'},messages:{start:'테스트 시작',categoryRequired:'구분을 골라주세요.',thanks:'완료했습니다.',closed:'테스트 마감'},sections:themes.map((theme,i)=>({id:'section'+i,title:'영역 '+i,subtitle:'테스트 평가',theme,questions:[{id:'S'+i,type:'score',prompt:'점수 '+i,shortLabel:'항목 '+i,required:true},{id:'T'+i,type:'text',prompt:'의견 '+i,required:true,linkedScores:['S'+i]}]}))};
let mock,web,b,stopServers,worker;let passed=0;const results=[];
const cli=(script,args=[])=>{const r=spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;};
async function putContent(c){const dir=path.join(root,'surveys',c.surveyId);await mkdir(dir);await writeFile(path.join(dir,'survey.json'),JSON.stringify(c,null,2));}
async function register(endpoint,surveyId,deadline){const r=await fetch(endpoint+'/v1/admin/surveys/'+surveyId,{method:'PUT',headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},body:JSON.stringify({version:content.version,deadline,status:'open'})});assert.equal(r.status,200);}
async function stop(child){if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}}
async function check(name,fn){await fn();passed++;results.push({name,status:'PASS'});console.log('PASS '+name);}
try{
  await putContent(content);await putContent({...content,surveyId:closedId,deadline:'2021-01-01T00:00:00Z'});
  stopServers=await startServers();
  mock=await startMock({port:18802,env:{REPORT_SECRET:secret,ADMIN_SECRET:admin,ALLOWED_ORIGINS:'http://127.0.0.1:18800,http://127.0.0.1:18809'}});
  b=await browser();
  const direct=`http://127.0.0.1:18800/surveys/${id}/`;
  async function open(url){await b.navigate(url);await b.wait(`!!document.querySelector('.intro-affiliation')`);}
  async function begin(){await b.evaluate(`document.querySelector('#aff_0').click();document.querySelector('[data-action="start"]').click()`);await b.wait(`!!document.querySelector('.score-slider')`);}
  async function fill(){await b.evaluate(`document.querySelectorAll('.score-slider').forEach((el,i)=>{el.value=i===0?6:8;el.dispatchEvent(new Event('input',{bubbles:true}));});document.querySelector('#na_S1').click();document.querySelectorAll('textarea').forEach(el=>{el.value='  흐름 테스트 원문  ';el.dispatchEvent(new Event('input',{bubbles:true}));});`);}
  async function submit(){await b.evaluate(`document.querySelector('[data-action="submit"]').click()`);}
  await check('New runtime survey content renders without engine changes; message overrides and mixed themes',async()=>{
    cli('tools/validate.mjs',[`surveys/${id}/survey.json`]);await open(direct);
    assert.equal(await b.evaluate(`document.querySelector('[data-action="start"]').textContent`),'테스트 시작');
    await b.evaluate(`document.querySelector('[data-action="start"]').click()`);assert.equal(await b.evaluate(`document.querySelector('#introErr').textContent`),'구분을 골라주세요.');
    await begin();assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.section-head')].map(el=>getComputedStyle(el).backgroundColor)`),['rgb(238, 245, 242)','rgb(238, 243, 248)','rgb(250, 243, 233)','rgb(243, 239, 247)']);
    assert.equal(await b.evaluate(`document.querySelectorAll('[onclick],[oninput]').length`),0);
    const policy=(await fetch(direct)).headers.get('content-security-policy');assert.ok(!policy.includes('unsafe-inline'));
  });
  let plan;
  await check('Validate -> dry-run frozen bundle -> subpath browser render',async()=>{
    plan=JSON.parse(cli('tools/deploy.mjs',[id,'--target','github-pages','--dry-run','--base-url','http://127.0.0.1:18809/MD-test']));
    assert.equal(plan.mode,'dry-run');assert.equal(plan.registry.body.deadline,content.deadline);await verifyBundle(plan.directory);
    web=spawn(process.execPath,['tools/preview.mjs'],{cwd:root,env:{...process.env,PREVIEW_PORT:'18809',COLLECTOR_PORT:'18802',BUNDLE_ROOT:plan.directory,BUNDLE_PREFIX:'/MD-test'},stdio:'ignore',detached:true});
    await until(async()=>{if(web.exitCode!==null)throw new Error('Frozen preview failed');try{return (await fetch(plan.url)).ok;}catch{return false;}},'bundle preview');
    await open(plan.url);await begin();assert.equal(await b.evaluate(`document.querySelector('.score-slider').max`),'10');
  });
  let envelope;
  await check('Frozen engine worker adapter -> local collector -> byte-preserved raw record',async()=>{
    await register(content.collector.endpoint,id,content.deadline);await fill();await submit();await b.wait(`!!document.querySelector('.done')`);
    assert.equal(await b.evaluate(`document.querySelector('.done h2').textContent`),'완료했습니다.');
    const read=await fetch(content.collector.endpoint+'/v1/responses/'+id,{headers:{Authorization:'Bearer '+secret}});assert.equal(read.status,200);const records=(await read.json()).responses;assert.equal(records.length,1);envelope=records[0];
    const sent=b.cdp.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST').at(-1).params.request;
    assert.equal(envelope.raw,sent.postData);assert.ok(sent.headers['X-Submission-Id']);
    const payload=JSON.parse(envelope.raw);assert.equal(payload.answers.S0,6);assert.equal(payload.answers.S1,'NA');assert.equal(payload.answers.T0,'흐름 테스트 원문');
    assert.equal((await fetch(content.collector.endpoint+'/v1/responses/'+id)).status,401);
    const duplicate=await fetch(content.collector.endpoint+'/v1/submit/'+id,{method:'POST',headers:{'X-Submission-Id':sent.headers['X-Submission-Id']},body:envelope.raw});assert.equal((await duplicate.json()).id,envelope.id);
  });
  await check('Stored response -> report CLI -> XLSX re-read with NA exclusion and linked scores',async()=>{
    const file=path.join(temp,'responses.jsonl');await writeFile(file,JSON.stringify(envelope)+'\n');
    cli('tools/report.mjs',[id,'--source','jsonl',file,'--out',path.join(temp,'reports')]);
    const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(temp,'reports',id+'-report.xlsx'));
    assert.deepEqual(wb.worksheets.map(s=>s.name),['raw','responses','summary','questions','text_linked','report_text']);
    assert.equal(wb.getWorksheet('raw').getCell('H2').value,envelope.raw);
    const rows=wb.getWorksheet('questions').getSheetValues().slice(2).map(r=>r.slice(1));assert.equal(rows.find(r=>r[0]==='S1')[7],1);assert.equal(rows.find(r=>r[0]==='S1')[6],0);
    const summary=Object.fromEntries(wb.getWorksheet('summary').getSheetValues().slice(2).map(r=>r.slice(1)));assert.equal(summary.overall,22/3);
    const linked=wb.getWorksheet('text_linked').getCell('F3').value;assert.match(linked,/평가안함/);
    assert.match(await readFile(path.join(temp,'reports/report.txt'),'utf8'),/흐름 테스트 원문/);
  });
  await check('Distribution CLI -> QR decodes exact subpath URL and notice includes all content slots',async()=>{
    cli('tools/distribute.mjs',[id,'--base-url','http://127.0.0.1:18809/MD-test']);
    const png=PNG.sync.read(await readFile(path.join(plan.directory,'qr.png')));assert.equal(jsQR(new Uint8ClampedArray(png.data),png.width,png.height).data,plan.url);
    const notice=await readFile(path.join(plan.directory,'kakao.txt'),'utf8');for(const value of Object.values(content.distribution))assert.ok(notice.includes(value));assert.ok(notice.includes(plan.url));
    await verifyBundle(plan.directory); // Artifacts cannot alter frozen survey bytes.
  });
  await check('Client past deadline -> Closed screen with no submit controls or POST',async()=>{
    const before=b.cdp.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST').length;
    await b.navigate(`http://127.0.0.1:18800/surveys/${closedId}/`);await b.wait(`!!document.querySelector('.closed')`);assert.equal(await b.evaluate(`document.querySelectorAll('button').length`),0);
    assert.equal(b.cdp.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST').length,before);
  });
  await check('Server deadline passes while client remains open -> mock HTTP 410 -> Closed',async()=>{
    await open(plan.url);await begin();await fill();await register(content.collector.endpoint,id,new Date(Date.now()-1000).toISOString());await submit();await b.wait(`!!document.querySelector('.closed')`);
    assert.equal(await b.evaluate(`document.querySelector('.closed h2').textContent`),'테스트 마감');
    assert.ok(b.cdp.events.some(e=>e.method==='Network.responseReceived'&&e.params.response.status===410));
  });
  await check('Real Wrangler/D1 browser submit and server-close HTTP 410',async()=>{
    const cfg=path.join(temp,'wrangler.toml'),state=path.join(temp,'state');
    await writeFile(cfg,`name="sf-flow-test"\nmain=${JSON.stringify(path.join(root,'collector/worker.js'))}\ncompatibility_date="2026-04-01"\n[[d1_databases]]\nbinding="DB"\ndatabase_name="sf-flow"\ndatabase_id="00000000-0000-0000-0000-000000000000"\n`);
    const env={...process.env,XDG_CONFIG_HOME:temp,WRANGLER_LOG_PATH:path.join(temp,'logs'),WRANGLER_SEND_METRICS:'false',CI:'1',NO_COLOR:'1'};
    const wrangler=path.join(root,'node_modules/.bin/wrangler');
    const mig=spawnSync(wrangler,['d1','execute','DB','--local','--persist-to',state,'--config',cfg,'--file',path.join(root,'collector/schema.sql')],{env,cwd:temp,encoding:'utf8',timeout:30000});assert.equal(mig.status,0,mig.stderr);
    worker=spawn(wrangler,['dev','--local','--ip','127.0.0.1','--port','18804','--inspector-port','18805','--persist-to',state,'--config',cfg,'--var','REPORT_SECRET:'+secret,'--var','ADMIN_SECRET:'+admin,'--var','ALLOWED_ORIGINS:http://127.0.0.1:18800'],{env,cwd:temp,stdio:'ignore'});
    const endpoint='http://127.0.0.1:18804';await until(async()=>{if(worker.exitCode!==null)throw new Error('Wrangler exited');try{return (await fetch(endpoint+'/v1/status/probe')).status===404;}catch{return false;}},'Wrangler');
    await writeFile(path.join(root,'surveys',id,'survey.json'),JSON.stringify({...content,collector:{adapter:'worker',endpoint}}));
    await register(endpoint,id,content.deadline);await open(direct);await begin();await fill();await submit();await b.wait(`!!document.querySelector('.done')`);
    const responses=await (await fetch(endpoint+'/v1/responses/'+id,{headers:{Authorization:'Bearer '+secret}})).json();assert.equal(responses.count,1);
    await open(direct);await begin();await fill();await register(endpoint,id,new Date(Date.now()-1000).toISOString());await submit();await b.wait(`!!document.querySelector('.closed')`);
  });
  assert.deepEqual(b.blocked,[]);assert.deepEqual(b.errors,[]);
  await mkdir(path.join(root,'_preview'),{recursive:true});await writeFile(path.join(root,'_preview/phase-b-flow.json'),JSON.stringify({passed,results,externalRequests:b.blocked.length},null,2));
  console.log(`PASS ${passed} content-to-output flow checks`);
}catch(e){console.error(e.stack);process.exitCode=1;}
finally{
  await b?.close();await stop(worker);await stop(web);await mock?.close();await stopServers?.();
  for(const folder of [path.join(root,'surveys',id),path.join(root,'surveys',closedId),path.join(root,'dist',id),temp])await rm(folder,{recursive:true,force:true});
}
