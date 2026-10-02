#!/usr/bin/env node
import {readFile,writeFile,mkdir,readdir,stat,rename,rm,mkdtemp,cp} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {validateFile} from './validate.mjs';
import {surveyUrl} from '../lib/url.mjs';
const projectRoot=new URL('../',import.meta.url).pathname;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(file){try{await stat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function filesUnder(dir,prefix=''){
  const files=[];
  for(const item of await readdir(dir,{withFileTypes:true})){
    const rel=path.posix.join(prefix,item.name);
    if(item.isSymbolicLink())throw new Error('Symlinks are not allowed in deployment bundles');
    if(item.isDirectory())files.push(...await filesUnder(path.join(dir,item.name),rel));else files.push(rel);
  }
  return files.sort();
}
export async function verifyBundle(directory){
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json')));
  const actual=(await filesUnder(directory)).filter(p=>p!=='manifest.json' && !['qr.png','kakao.txt','link.txt'].includes(p) && !p.startsWith('reports/'));
  if(JSON.stringify(actual)!==JSON.stringify(Object.keys(manifest.files).sort()))throw new Error('Published bundle file set changed');
  for(const [name,digest] of Object.entries(manifest.files)){
    if(path.isAbsolute(name)||name.split('/').includes('..'))throw new Error('Invalid manifest path');
    if(hash(await readFile(path.join(directory,name)))!==digest)throw new Error(`Published bundle changed: ${name}`);
  }
  return manifest;
}
export async function assertPublished(publishedRoot,id,manifest,{allowUpdate=false}={}){
  if(!await exists(publishedRoot))return;
  for(const entry of await readdir(publishedRoot,{withFileTypes:true})){
    if(!entry.isDirectory())continue;
    const old=await verifyBundle(path.join(publishedRoot,entry.name));
    if(entry.name===id && JSON.stringify(old.files)!==JSON.stringify(manifest.files) && !allowUpdate)throw new Error(`Refusing to overwrite published/${id}; explicit --allow-update required`);
  }
}
function csp(content){
  const endpoint=new URL(content.collector.endpoint);
  return `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${endpoint.origin}; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'`;
}
export async function buildSurvey(id,{root=projectRoot,target='github-pages',baseUrl='https://example.invalid',allowUpdate=false}={}){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw new Error('Invalid survey id');
  if(!['github-pages','cloudflare'].includes(target))throw new Error('Invalid deployment target');
  const base=new URL(baseUrl);
  if(!['http:','https:'].includes(base.protocol)||base.search||base.hash||base.username||base.password)throw new Error('Invalid base URL');
  const content=await validateFile(path.join(root,'surveys',id,'survey.json')); // Gate before any writes.
  const source=name=>readFile(path.join(projectRoot,'engine',name),'utf8');
  const storage=await source('storage.js'),messages=await source('messages.js');
  const storageName=`storage.${hash(storage).slice(0,16)}.js`,messagesName=`messages.${hash(messages).slice(0,16)}.js`;
  const rewrite=(code,from,to)=>{if(!code.includes(`'${from}'`))throw new Error(`Engine import specifier '${from}' not found in survey.js; update the bundle rewrite`);return code.replace(`'${from}'`,`'${to}'`);};
  const engine=rewrite(rewrite(await source('survey.js'),'./storage.js',`./${storageName}`),'./messages.js',`./${messagesName}`);
  const engineName=`engine.${hash(engine).slice(0,16)}.js`;
  const styles=(await source('themes.css'))+'\n'+await source('styles.css'),styleName=`styles.${hash(styles).slice(0,16)}.css`;
  const policy=csp(content);
  const html=(await source('index.html')).replace(/\s*<link rel="stylesheet" href="\.\.\/\.\.\/engine\/themes.css">/,'').replace('../../engine/styles.css',`./assets/${styleName}`).replace('../../engine/survey.js',`./assets/${engineName}`).replace('<meta charset="utf-8">',`<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`);
  for(const needle of [`./assets/${styleName}`,`./assets/${engineName}`,'Content-Security-Policy'])if(!html.includes(needle))throw new Error(`Bundle HTML rewrite failed: ${needle} missing; update tools/deploy.mjs`);
  const prefix=`surveys/${id}/`;
  const output={
    [prefix+'index.html']:html,[prefix+'survey.json']:JSON.stringify(content,null,2)+'\n',
    [prefix+'assets/'+engineName]:engine,[prefix+'assets/'+storageName]:storage,[prefix+'assets/'+messagesName]:messages,[prefix+'assets/'+styleName]:styles,
    '_headers':`/surveys/${id}/*\n  Content-Security-Policy: ${policy}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n`
  };
  const manifest={surveyId:id,version:content.version,engineVersion:JSON.parse(await readFile(path.join(projectRoot,'package.json'))).version,files:Object.fromEntries(Object.entries(output).sort(([a],[b])=>a.localeCompare(b)).map(([file,bytes])=>[file,hash(bytes)]))};
  const published=path.join(root,'published');
  await assertPublished(published,id,manifest,{allowUpdate});
  const dist=path.join(root,'dist');await mkdir(dist,{recursive:true});
  const stage=await mkdtemp(path.join(dist,'.build-')),directory=path.join(dist,id);
  try{
    for(const [file,bytes] of Object.entries(output)){await mkdir(path.dirname(path.join(stage,file)),{recursive:true});await writeFile(path.join(stage,file),bytes);}
    await writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    // Replace only this survey's generated output. Other IDs and published/ are untouched.
    await rm(directory,{recursive:true,force:true});await rename(stage,directory);
  }finally{await rm(stage,{recursive:true,force:true});}
  const registry=content.collector.adapter==='worker'?{method:'PUT',url:content.collector.endpoint.replace(/\/$/,'')+'/v1/admin/surveys/'+id,authorization:'Bearer <ADMIN_SECRET from environment>',body:{surveyId:id,version:content.version,deadline:content.deadline,status:'open'}}:null;
  const plan={mode:'dry-run',target,surveyId:id,directory,url:surveyUrl(baseUrl,id),files:[...Object.keys(manifest.files),'manifest.json'],registry,
    publishCommand:target==='cloudflare'?'wrangler pages deploy <verified published union> --project-name <project>':'copy only this survey bundle into <repo>/<prefix>/surveys/<id>; git add only that path (no push)',
    notes:content.collector.adapter==='local-mock'?['Local mock adapter: preview only; choose a production collector before approval.']:[]};
  return {content,manifest,plan,directory};
}
// Stages only <repo>/<prefix>/surveys/<id>; never touches other paths. Local `git add` of that single path, no commit/push.
export async function stageGithubPages({repo,prefix='',id,published,allowUpdate=false}){
  if(path.isAbsolute(prefix)||prefix.split(/[\\/]/).includes('..'))throw new Error('Invalid repository prefix');
  const destination=path.join(path.resolve(repo),prefix,'surveys',id);
  await mkdir(path.dirname(destination),{recursive:true});
  if(await exists(destination)){
    if(!allowUpdate)throw new Error('Destination exists; --allow-update required');
    await rm(destination,{recursive:true});
  }
  await cp(path.join(published,'surveys',id),destination,{recursive:true});
  const r=spawnSync('git',['-C',path.resolve(repo),'add','--',path.relative(path.resolve(repo),destination)],{stdio:'inherit'});
  if(r.status!==0)throw new Error('Local staging failed');
  return destination;
}
// Cloudflare Pages uploads the whole project, so the upload is the union of every published bundle, each verified against its manifest first.
export async function stageCloudflareUpload(publishedRoot,upload){
  let headers='';
  for(const entry of await readdir(publishedRoot,{withFileTypes:true}))if(entry.isDirectory()){
    const folder=path.join(publishedRoot,entry.name);await verifyBundle(folder);
    await cp(path.join(folder,'surveys',entry.name),path.join(upload,'surveys',entry.name),{recursive:true});headers+=await readFile(path.join(folder,'_headers'),'utf8');
  }
  await writeFile(path.join(upload,'_headers'),headers);
}
// Real publication path is explicit opt-in. Tests and agent work invoke only build/dry-run.
export async function publish(result,options){
  if(!options.confirm)throw new Error('Publication requires explicit --confirm');
  const {content,manifest,directory}=result;
  if(content.collector.adapter==='local-mock')throw new Error('Refusing to publish local-mock content');
  if(options.target==='github-pages'&&!options.repo)throw new Error('--repo is required');
  if(options.target==='cloudflare'&&!options.project)throw new Error('--project is required');
  if(content.collector.adapter==='worker'&&!process.env.ADMIN_SECRET)throw new Error('ADMIN_SECRET is required for registry update');
  const root=options.root||projectRoot,publishedRoot=path.join(root,'published');
  await assertPublished(publishedRoot,content.surveyId,manifest,options);
  const published=path.join(publishedRoot,content.surveyId);
  if(await exists(published))await rm(published,{recursive:true});
  await mkdir(published,{recursive:true});
  for(const file of [...Object.keys(manifest.files),'manifest.json']){await mkdir(path.dirname(path.join(published,file)),{recursive:true});await cp(path.join(directory,file),path.join(published,file));}
  if(options.target==='github-pages')await stageGithubPages({repo:options.repo,prefix:options.prefix,id:content.surveyId,published,allowUpdate:options.allowUpdate});
  else{
    const upload=await mkdtemp(path.join(root,'dist','.upload-'));
    try{
      await stageCloudflareUpload(publishedRoot,upload);
      const r=spawnSync(path.join(projectRoot,'node_modules/.bin/wrangler'),['pages','deploy',upload,'--project-name',options.project],{stdio:'inherit'});
      if(r.status!==0)throw new Error('Pages upload failed');
    }finally{await rm(upload,{recursive:true,force:true});}
  }
  if(result.plan.registry){
    const {url,body}=result.plan.registry;
    const r=await fetch(url,{method:'PUT',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.ADMIN_SECRET}`},body:JSON.stringify(body)});
    if(!r.ok)throw new Error('Registry update failed');
  }
}
export async function main(args=process.argv.slice(2)){
  const id=args[0],known=new Set(['--target','--base-url','--root','--repo','--prefix','--project','--dry-run','--confirm','--allow-update']);
  const flags=new Set(['--dry-run','--confirm','--allow-update']),values={};
  for(let i=1;i<args.length;i++){const key=args[i];if(!known.has(key))throw new Error(`Unknown option ${key}`);values[key]=flags.has(key)?true:args[++i];if(values[key]===undefined)throw new Error(`Missing value for ${key}`);}
  if(values['--dry-run']&&values['--confirm'])throw new Error('Choose dry-run or confirm, not both');
  const options={target:values['--target']||'github-pages',baseUrl:values['--base-url']||'https://example.invalid',root:values['--root']||projectRoot,allowUpdate:!!values['--allow-update'],confirm:!!values['--confirm'],repo:values['--repo'],prefix:values['--prefix'],project:values['--project']};
  const result=await buildSurvey(id,options);
  if(options.confirm)await publish(result,options);
  console.log(JSON.stringify({...result.plan,mode:options.confirm?'confirmed':'dry-run'},null,2));
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
