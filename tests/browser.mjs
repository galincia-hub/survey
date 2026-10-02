import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {connect,getJSON,until} from './cdp.mjs';
export async function browser(){
  const profile=await mkdtemp(path.join(tmpdir(),'sf-flow-'));
  const chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let cdp;
  const close=async()=>{cdp?.close();if(chrome.exitCode===null){const stopped=new Promise(r=>chrome.once('exit',r));chrome.kill('SIGTERM');await stopped;}await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});};
  try{
    let port;await until(async()=>{try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];return true;}catch{return false;}},'Chrome');
    cdp=await connect((await getJSON(`http://127.0.0.1:${port}/json/list`)).find(p=>p.type==='page').webSocketDebuggerUrl);
    const blocked=[],errors=[];
    cdp.setHandler(e=>{
      if(e.method==='Fetch.requestPaused'){
        const url=new URL(e.params.request.url),allowed=url.protocol==='data:' || url.origin==='http://127.0.0.1:'+url.port;
        if(!allowed)blocked.push(e.params.request.url);
        cdp.call(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:e.params.requestId,...(!allowed?{errorReason:'BlockedByClient'}:{})}).catch(()=>{});
      }
      if(e.method==='Runtime.exceptionThrown'||(e.method==='Runtime.consoleAPICalled'&&e.params.type==='error'))errors.push(e);
    });
    await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');await cdp.call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const evaluate=async expression=>{const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    return {cdp,blocked,errors,evaluate,wait:expression=>until(()=>evaluate(expression),expression),navigate:url=>cdp.call('Page.navigate',{url}),close};
  }catch(e){await close();throw e;}
}
