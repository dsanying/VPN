import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const directory=mkdtempSync(path.join(tmpdir(),'openconnect-auth-test-'));
const run=(command,args,options={})=>{const r=spawnSync(command,args,{encoding:'utf8',timeout:15000,...options});if(r.error)throw r.error;return r;};
try{
 const flags=run('pkg-config',['--cflags','openconnect','json-c']);assert.equal(flags.status,0);
 const libs=run('pkg-config',['--libs','json-c']);assert.equal(libs.status,0);
 const source=path.join(root,'enterprise-runtime/openconnect');
 const binary=path.join(directory,'auth'),reader=path.join(directory,'reader');
 assert.equal(run('cc',['-Wall','-Wextra',path.join(source,'auth.c'),path.join(source,'tests/mock-library.c'),...flags.stdout.trim().split(/\s+/),...libs.stdout.trim().split(/\s+/),'-o',binary]).status,0);
 assert.equal(run('cc',[path.join(source,'tests/cookie-reader.c'),'-o',reader]).status,0);
 for (const protocol of ['anyconnect','nc','pulse','gp','f5','fortinet','array']) {
 const probe=run(binary,['--probe',protocol,'https://example.com/',reader,''],{input:'{}\n'});assert.equal(probe.status,0);
 const form=JSON.parse(probe.stdout);assert.equal(form.fields[0].choices.length,2);
 const options=JSON.stringify({username:'fictional-user',password:'fictional-secret',selections:{group_list:'employees'}})+'\n';
 const connected=run(binary,['--connect',protocol,'https://example.com/',reader,''],{input:options});assert.equal(connected.status,0,connected.stderr);assert.equal(connected.stdout.trim(),'cookie pipe verified');assert(!connected.stdout.includes('fictional-secret'));
 const rejected=run(binary,['--connect',protocol,'https://example.com/',reader,''],{input:options,env:{...process.env,MOCK_BAD_CERT:'1'}});assert.equal(rejected.status,1);assert.equal(JSON.parse(rejected.stdout).reason,'authentication');
 const interactive=run(binary,['--connect',protocol,'https://example.com/',reader,''],{input:JSON.stringify({username:'fictional-user',password:'fictional-secret'})+'\n'+JSON.stringify({fields:{group_list:'employees'}})+'\n'});assert.equal(interactive.status,0);assert.equal(JSON.parse(interactive.stdout.split('\n')[0]).kind,'form');
 }
 console.log('Seven OpenConnect protocol adapters: authentication: discovery, saved group, interactive form, cookie pipe and certificate rejection passed');
}finally{rmSync(directory,{recursive:true,force:true});}
