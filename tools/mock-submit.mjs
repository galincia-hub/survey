// Test fixture only; durable collector, registry, auth and deadline enforcement are Phase B.
import http from 'node:http';
import {mkdir,appendFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const port=Number(process.env.COLLECTOR_PORT||18791);
const origin=`http://127.0.0.1:${Number(process.env.PREVIEW_PORT||18790)}`;
for(const value of [process.env.PREVIEW_PORT||18790,process.env.COLLECTOR_PORT||18791]){const n=Number(value);if(!Number.isInteger(n)||n<1024||n>65535||[8790,8791].includes(n))throw new Error('Invalid or reserved local port');}
const directory=new URL('../_preview/',import.meta.url);
await mkdir(directory,{recursive:true});
http.createServer(async(req,res)=>{
  res.setHeader('X-Survey-Factory','mock');
  if(req.url==='/health' && req.method==='GET'){res.writeHead(200).end('mock');return;}
  if(req.headers.origin!==origin) {res.writeHead(403).end();return;}
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Survey-Id');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  if(req.method!=='POST' || req.url!=='/submit'){res.writeHead(404).end();return;}
  try{
    let raw='';
    for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>200000)throw new Error('Too large');}
    const payload=JSON.parse(raw);
    const surveyId=req.headers['x-survey-id'];
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(surveyId||'') || !payload.answers || !payload.submittedAt) throw new Error('Invalid mock payload');
    const id=randomUUID();
    await appendFile(new URL('mock-responses.jsonl',directory),JSON.stringify({id,surveyId,raw})+'\n');
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true,id}));
  }catch{res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:'invalid_mock_request'}));}
}).listen(port,'127.0.0.1',()=>console.log(`Local-only mock http://127.0.0.1:${port}/submit`));
