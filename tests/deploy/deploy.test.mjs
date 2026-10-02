import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {buildSurvey,verifyBundle,publish,stageGithubPages,stageCloudflareUpload} from '../../tools/deploy.mjs';
const sample=JSON.parse(await readFile(new URL('../../surveys/sample-survey/survey.json',import.meta.url)));
const deploy=new URL('../../tools/deploy.mjs',import.meta.url).pathname;
async function put(root,id,edit={}){await mkdir(path.join(root,'surveys',id),{recursive:true});await writeFile(path.join(root,'surveys',id,'survey.json'),JSON.stringify({...sample,surveyId:id,...edit}));}
test('dry-run frozen manifests, relative assets, validation gate, isolation and published overwrite guard',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sf-deploy-'));
  try{
    await put(root,'build-a');await put(root,'build-b');
    const a=await buildSurvey('build-a',{root});const original=await readFile(path.join(a.directory,'manifest.json'),'utf8');
    const b=await buildSurvey('build-b',{root,target:'cloudflare'});
    assert.equal(await readFile(path.join(a.directory,'manifest.json'),'utf8'),original);await verifyBundle(a.directory);await verifyBundle(b.directory);
    const html=await readFile(path.join(a.directory,'surveys/build-a/index.html'),'utf8');assert.match(html,/\.\/assets\/engine\.[a-f0-9]+\.js/);assert.doesNotMatch(html,/unsafe-inline|\/engine\//);
    assert.ok(!Object.keys(a.manifest.files).some(x=>x.includes('source/')));
    assert.equal(a.plan.mode,'dry-run');assert.equal(b.plan.target,'cloudflare');
    const published=path.join(root,'published','build-a');await mkdir(path.dirname(published),{recursive:true});await cp(a.directory,published,{recursive:true});
    await put(root,'build-a',{title:'Changed'});await assert.rejects(buildSurvey('build-a',{root}),/overwrite/);
    assert.equal(await readFile(path.join(a.directory,'manifest.json'),'utf8'),original);
    const changed=await buildSurvey('build-a',{root,allowUpdate:true});assert.notDeepEqual(changed.manifest.files,a.manifest.files);assert.equal(await readFile(path.join(published,'manifest.json'),'utf8'),original,'dry-run must never mutate published');
    await writeFile(path.join(published,'surveys/build-a/index.html'),'tampered');await assert.rejects(buildSurvey('build-b',{root}),/Published bundle changed/);
    await put(root,'bad-content',{title:''});const invalid=spawnSync(process.execPath,[deploy,'bad-content','--root',root,'--dry-run'],{encoding:'utf8'});assert.notEqual(invalid.status,0);assert.ok(!(await readdir(path.join(root,'dist'))).includes('bad-content'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('real path refuses without --confirm and for local-mock content; CLI without --confirm stays dry-run',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sf-deploy-'));
  try{
    await put(root,'guard-a');
    const built=await buildSurvey('guard-a',{root});
    await assert.rejects(publish(built,{root,target:'github-pages',repo:root}),/explicit --confirm/);
    await assert.rejects(publish(built,{root,target:'github-pages',repo:root,confirm:true}),/local-mock/);
    await assert.rejects(readdir(path.join(root,'published')),/ENOENT/,'refusals must not create published/');
    const cli=spawnSync(process.execPath,[deploy,'guard-a','--root',root],{encoding:'utf8'});
    assert.equal(cli.status,0);assert.equal(JSON.parse(cli.stdout).mode,'dry-run');
    const both=spawnSync(process.execPath,[deploy,'guard-a','--root',root,'--dry-run','--confirm'],{encoding:'utf8'});assert.notEqual(both.status,0);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('github-pages adapter stages only its own survey path in the target repo',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sf-deploy-')),repo=await mkdtemp(path.join(tmpdir(),'sf-repo-'));
  const git=(...args)=>spawnSync('git',['-C',repo,...args],{encoding:'utf8'});
  try{
    await put(root,'gh-a');await put(root,'gh-b');
    const a=await buildSurvey('gh-a',{root});
    const published=path.join(root,'published','gh-a');await mkdir(path.dirname(published),{recursive:true});await cp(a.directory,published,{recursive:true});
    assert.equal(git('init','-q').status,0);
    await mkdir(path.join(repo,'MD/surveys/gh-b'),{recursive:true});await writeFile(path.join(repo,'MD/surveys/gh-b/index.html'),'other survey');
    await writeFile(path.join(repo,'README.md'),'unrelated');await writeFile(path.join(repo,'untracked.txt'),'x');
    const before=await readFile(path.join(repo,'MD/surveys/gh-b/index.html'),'utf8');
    await assert.rejects(stageGithubPages({repo,prefix:'../x',id:'gh-a',published}),/Invalid repository prefix/);
    await stageGithubPages({repo,prefix:'MD',id:'gh-a',published});
    const staged=git('diff','--cached','--name-only').stdout.trim().split('\n').sort();
    assert.ok(staged.length>0&&staged.every(f=>f.startsWith('MD/surveys/gh-a/')),staged.join(','));
    assert.equal(await readFile(path.join(repo,'MD/surveys/gh-b/index.html'),'utf8'),before);
    assert.equal(git('log','--oneline').status!==0||git('log','--oneline').stdout==='',true,'no commit is made');
    await assert.rejects(stageGithubPages({repo,prefix:'MD',id:'gh-a',published}),/--allow-update/);
    await stageGithubPages({repo,prefix:'MD',id:'gh-a',published,allowUpdate:true});
  }finally{await rm(root,{recursive:true,force:true});await rm(repo,{recursive:true,force:true});}
});
test('cloudflare adapter verifies every other published manifest before assembling the union upload',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sf-deploy-')),upload=await mkdtemp(path.join(tmpdir(),'sf-upload-'));
  try{
    await put(root,'cf-a');await put(root,'cf-b');
    for(const id of ['cf-a','cf-b']){const r=await buildSurvey(id,{root,target:'cloudflare'});const dest=path.join(root,'published',id);await mkdir(path.dirname(dest),{recursive:true});await cp(r.directory,dest,{recursive:true});}
    const publishedRoot=path.join(root,'published');
    await stageCloudflareUpload(publishedRoot,upload);
    assert.ok((await readFile(path.join(upload,'_headers'),'utf8')).includes('/surveys/cf-a/*')&&(await readFile(path.join(upload,'_headers'),'utf8')).includes('/surveys/cf-b/*'));
    assert.deepEqual((await readdir(path.join(upload,'surveys'))).sort(),['cf-a','cf-b']);
    await writeFile(path.join(publishedRoot,'cf-a/surveys/cf-a/survey.json'),'{"tampered":true}');
    const second=await mkdtemp(path.join(tmpdir(),'sf-upload-'));try{await assert.rejects(stageCloudflareUpload(publishedRoot,second),/Published bundle changed/);}finally{await rm(second,{recursive:true,force:true});}
  }finally{await rm(root,{recursive:true,force:true});await rm(upload,{recursive:true,force:true});}
});
