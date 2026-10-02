import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {validate} from './validate.mjs';
const root=new URL('../',import.meta.url);
const port=Number(process.env.PREVIEW_PORT||18790);
const collectorPort=Number(process.env.COLLECTOR_PORT||18791);
for(const value of [process.env.PREVIEW_PORT||18790,process.env.COLLECTOR_PORT||18791]){const n=Number(value);if(!Number.isInteger(n)||n<1024||n>65535||[8790,8791].includes(n))throw new Error('Invalid or reserved local port');}
const types={html:'text/html',css:'text/css',js:'text/javascript',json:'application/json'};
http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:${collectorPort}; form-action 'none'; frame-src 'none'; base-uri 'none'`);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Survey-Factory','preview');
  try {
    if(req.method!=='GET') {res.writeHead(405).end();return;}
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    const survey=pathname.match(/(?:^|\/)surveys\/([a-z0-9-]+)\/(survey\.json|index\.html)?$/);
    let file;
    if(survey){
      const bytes=await readFile(new URL(`surveys/${survey[1]}/survey.json`,root));
      const data=JSON.parse(bytes); const errors=validate(data);
      if(data.surveyId!==survey[1]) errors.push('Content id must match path');
      if(errors.length){res.writeHead(422,{'Content-Type':'text/plain; charset=utf-8'}).end(errors.join('\n'));return;}
      if(survey[2]==='survey.json') {
        data.collector.endpoint=`http://127.0.0.1:${collectorPort}/submit`; res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(data));return;}
      file='engine/index.html';
    } else if(/(?:^|\/)engine\/(index\.html|survey\.js|storage\.js|styles\.css)$/.test(pathname)) file='engine/'+pathname.split('/').at(-1);
    else {res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':`${types[file.split('.').pop()]}; charset=utf-8`}).end(await readFile(new URL(file,root)));
  }catch{res.writeHead(404).end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Static preview http://127.0.0.1:${port}/surveys/<id>/`));
