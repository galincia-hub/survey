import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,cp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {buildSurvey,verifyBundle} from '../../tools/deploy.mjs';
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
