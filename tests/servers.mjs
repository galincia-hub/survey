import {spawn} from 'node:child_process';
import {until} from './cdp.mjs';
export async function startServers(){
  const owned=[];
  async function stop(){for(const child of owned)if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}}
  try{
    for(const [script,port,kind,route] of [
      ['tools/preview.mjs',process.env.PREVIEW_PORT||18800,'preview','/'],
      ['tools/mock-submit.mjs',process.env.COLLECTOR_PORT||18801,'mock','/health']
    ]){
      const url=`http://127.0.0.1:${port}${route}`;
      const probe=()=>fetch(url,{signal:AbortSignal.timeout(1000)}).then(r=>r.headers.get('X-Survey-Factory')).catch(()=>null);
      const existing=await probe();
      if(existing===kind)continue;
      if(existing)throw new Error(`Port ${port} belongs to another server`);
      const child=spawn(process.execPath,[script],{cwd:new URL('../',import.meta.url),stdio:['ignore','ignore','pipe'],detached:true,env:{...process.env,PREVIEW_PORT:String(process.env.PREVIEW_PORT||18800),COLLECTOR_PORT:String(process.env.COLLECTOR_PORT||18801)}});owned.push(child);
      let log='';child.stderr.on('data',d=>log+=d);
      await until(async()=>{if(child.exitCode!==null)throw new Error(`Cannot start ${script}: ${log}`);return await probe()===kind;},script);
    }
    return stop;
  }catch(e){await stop();throw e;}
}
