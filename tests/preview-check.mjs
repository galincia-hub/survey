import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {connect,until,getJSON,delay} from './cdp.mjs';
import {startServers} from './servers.mjs';
import {diffPNG} from './png.mjs';
const root=new URL('../',import.meta.url);
const base=`http://127.0.0.1:${process.env.PREVIEW_PORT||18800}`;
const collector=`http://127.0.0.1:${process.env.COLLECTOR_PORT||18801}`;
const liveMode=process.argv.includes('--live-baseline');
let stopServers;
const live='https://galincia-hub.github.io/MD/adora-ship-visit-0929/survey/?v=20261001-charter-emphasis';
let chrome,client,profile;let passed=0;const results=[];const blocked=[];
async function check(label,fn){await fn();passed++;results.push({label,status:'PASS'});console.log('PASS '+label);}
try{
  await mkdir(new URL('_preview/',root),{recursive:true});
  if(!liveMode)stopServers=await startServers();
  profile=await mkdtemp(path.join(tmpdir(),'sf-preview-'));
  chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let log='';chrome.stderr.on('data',d=>log+=d);
  let port;await until(async()=>{if(chrome.exitCode!==null)throw new Error(log);try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];return true;}catch{return false;}},'Chrome port');
  client=await connect((await getJSON(`http://127.0.0.1:${port}/json/list`)).find(p=>p.type==='page').webSocketDebuggerUrl);
  await client.call('Page.enable');await client.call('Runtime.enable');await client.call('Network.enable');
  client.setHandler(message=>{
    if(message.method!=='Fetch.requestPaused')return;
    const {request,requestId}=message.params;const u=new URL(request.url);
    const local=[base,collector].includes(u.origin);
    const readOnly=liveMode && u.origin==='https://galincia-hub.github.io' && request.method==='GET';
    if(local||readOnly||u.protocol==='data:')client.call('Fetch.continueRequest',{requestId}).catch(()=>{});
    else {blocked.push({url:request.url,method:request.method});client.call('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
  });
  await client.call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  await client.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await client.call('Emulation.setTouchEmulationEnabled',{enabled:true});
  await client.call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK/11.0',platform:'iPhone'});
  if(!liveMode)await client.call('Page.addScriptToEvaluateOnNewDocument',{source:'Date.now=()=>1790899200000;'});
  const ev=async expression=>{const r=await client.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const wait=expression=>until(()=>ev(expression),expression);
  const nav=async url=>{await client.call('Page.navigate',{url});try{await wait(`!!document.querySelector('.intro-affiliation')`);}catch(e){console.log('PAGE',await ev('document.body.innerText.slice(0,1000)'));console.log('EVENTS',client.events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Network.loadingFailed'));throw e;}await ev('document.fonts.ready');await delay(350);};
  const click=text=>ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const start=async()=>{await ev(`document.querySelector('#aff_0').click()`);await click('설문 시작하기');await wait(`!!document.querySelector('.score-slider')`);};
  const shot=async(name,full=false)=>{await ev('scrollTo({top:0,behavior:"instant"})');await delay(350);const metrics=full?(await client.call('Page.getLayoutMetrics')).cssContentSize:null;const {data}=await client.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:full,...(full?{clip:{x:0,y:0,width:390,height:Math.ceil(metrics.height),scale:1}}:{})});await writeFile(new URL('_preview/'+name,root),Buffer.from(data,'base64'));};
  if(liveMode){
    await mkdir(new URL('tests/baseline/adora/',root),{recursive:true});
    await nav(live);await shot('live-intro.png');await shot('live-intro-full.png',true);await start();await shot('live-survey.png');await shot('live-survey-full.png',true);
    for(const stage of ['intro','survey','intro-full','survey-full'])await writeFile(new URL(`tests/baseline/adora/${stage}.png`,root),await readFile(new URL(`_preview/live-${stage}.png`,root)));
    await writeFile(new URL('tests/baseline/adora/source.json',root),JSON.stringify({url:live,capturedAt:new Date().toISOString(),viewport:{width:390,height:844,dpr:1},method:'GET-only; no submissions'},null,2)+'\n');
    console.log('PASS read-only live baseline capture');
  }else{
  await check('Local preview loads at 390x844; category required',async()=>{
    await nav(base+'/surveys/adora-ship-visit-001/');assert.deepEqual(await ev('[innerWidth,innerHeight]'),[390,844]);
    await shot('local-intro.png');await shot('local-intro-full.png',true);
    await click('설문 시작하기');assert.ok(await ev(`document.querySelector('#introErr').textContent`));
    assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false);
  });
  await check('Category selection; untouched slider; score selection; NA',async()=>{
    await start();assert.equal(await ev(`document.querySelector('.score-slider').dataset.selected`),'');assert.equal(await ev(`document.querySelector('#score_O01').textContent`),'-');
    await shot('local-survey.png');await shot('local-survey-full.png',true);
    await click('제출하기');assert.ok(await ev(`document.querySelector('#err_O01').textContent`));
    await ev(`document.querySelector('.score-slider').focus()`);await client.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await client.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    assert.equal(await ev(`document.querySelector('.score-slider').dataset.selected`),'11');
    await ev(`document.querySelector('#na_O01').click()`);assert.equal(await ev(`document.querySelector('.score-slider').dataset.selected`),'NA');
  });
  await check('Required text, 1000-char limit and live counter, navigation persistence',async()=>{
    assert.equal(await ev(`document.querySelector('#err_F07').textContent`),'답변을 해주셔야만 설문을 완성할 수 있습니다.');
    await ev(`document.querySelector('textarea').focus()`);await client.call('Input.insertText',{text:'가'.repeat(1005)});
    assert.equal(await ev(`document.querySelector('textarea').value.length`),1000);assert.match(await ev(`document.querySelector('#count_F07').textContent`),/1,000\/1,000/);
    await click('이전');await click('설문 시작하기');assert.equal(await ev(`document.querySelector('textarea').value.length`),1000);assert.equal(await ev(`document.querySelector('.score-slider').dataset.selected`),'NA');
  });
  await check('Submit to local mock; exact legacy keys and raw stored payload',async()=>{
    await ev(`document.querySelectorAll('.unable-btn').forEach(b=>b.click());document.querySelectorAll('textarea').forEach(t=>{t.value='  테스트 원문  ';t.dispatchEvent(new Event('input'));})`);
    await click('제출하기');await wait(`!!document.querySelector('.done')`);
    const rows=(await readFile(new URL('_preview/mock-responses.jsonl',root),'utf8')).trim().split('\n').map(JSON.parse);
    const record=rows.at(-1),p=JSON.parse(record.raw);
    const sent=client.events.filter(e=>e.method==='Network.requestWillBeSent' && e.params.request.method==='POST').at(-1);
    assert.equal(record.raw,sent.params.request.postData,'Stored raw body must byte-match request');
    assert.equal(record.surveyId,'adora-ship-visit-001');assert.deepEqual(Object.keys(p).sort(),['version','ref','affiliation','surveyType','answers','submittedAt'].sort());assert.equal(p.ref,'');assert.equal(p.answers.O01,'NA');assert.equal(p.answers.F07,'테스트 원문');assert.equal(Object.keys(p.answers).length,18);
  });
  await check('Offline mobile pixel diff against saved live baseline',async()=>{
    const diffs={};
    for(const stage of ['intro','survey','intro-full','survey-full']){
      const {mask,...metrics}=diffPNG(await readFile(new URL(`tests/baseline/adora/${stage}.png`,root)),await readFile(new URL(`_preview/local-${stage}.png`,root)));
      diffs[stage]=metrics;await writeFile(new URL(`_preview/diff-${stage}.png`,root),mask);
    }
    console.log('VISUAL DIFF '+JSON.stringify(diffs));await writeFile(new URL('_preview/visual-diff.json',root),JSON.stringify(diffs,null,2)+'\n');
    for(const value of Object.values(diffs))assert.ok(value.percent<1,`Visual diff ${value.percent}% exceeds 1%`);
  });
  await check('Content-only sample route: alternate max, choice types, standard payload',async()=>{
    await nav(base+'/nested/prefix/surveys/sample-survey/index.html?ref=test');await start();assert.equal(await ev(`document.querySelector('.score-slider').max`),'10');
    await ev(`document.querySelector('.unable-btn').click();document.querySelector('textarea').value='샘플';document.querySelector('#Q03_0').click();document.querySelector('#Q04_0').click();document.querySelector('#Q04_1').click()`);
    await click('제출하기');await wait(`!!document.querySelector('.done')`);
    const rows=(await readFile(new URL('_preview/mock-responses.jsonl',root),'utf8')).trim().split('\n');const p=JSON.parse(JSON.parse(rows.at(-1)).raw);assert.equal(p.surveyId,'sample-survey');assert.equal(p.ref,'TEST');assert.deepEqual(p.answers.Q04,['교육','체험']);assert.equal(p.respondentCategory,'참가자');
  });
  await check('Browser has no uncaught exceptions',async()=>assert.deepEqual(client.events.filter(e=>e.method==='Runtime.exceptionThrown'),[]));
  await writeFile(new URL('_preview/test-results.json',root),JSON.stringify({passed,results,blocked},null,2)+'\n');
  assert.deepEqual(blocked,[],'Unexpected external requests');
  assert.deepEqual(client.events.filter(e=>e.method==='Runtime.consoleAPICalled' && e.params.type==='error'),[]);
  console.log(`PASS ${passed} browser checks`);
  }
}catch(e){console.error('FAIL '+e.stack);process.exitCode=1;}
finally{await stopServers?.();client?.close();if(chrome&&chrome.exitCode===null){const stopped=new Promise(r=>chrome.once('exit',r));chrome.kill('SIGTERM');await stopped;}if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
