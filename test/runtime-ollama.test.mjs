import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../src/runtime/process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const alive = pid => { try { process.kill(-pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
for (const fault of ['owner', 'startup-log', 'active-log']) test(`owned runtime cleans up after ${fault} I/O failure`, async t => {
  const parent = process.env.INSTALLER_TEST_EVIDENCE ?? fs.realpathSync(os.tmpdir()); fs.mkdirSync(parent, {recursive: true});
  const dir = fs.mkdtempSync(path.join(parent, 'runtime-io-')), copied = path.join(dir, 'package'); fs.mkdirSync(copied);
  for (const name of ['src', 'package.json', 'npm-shrinkwrap.json']) fs.cpSync(path.join(root, name), path.join(copied, name), {recursive: true});
  const binary = path.join(dir, 'ollama');
  fs.writeFileSync(binary, '#!' + process.execPath + '\n' + `
import http from 'node:http';
const [host,port]=process.env.OLLAMA_HOST.split(':');
const server=http.createServer((req,res)=>{if(req.url==='/emit')console.error('ACTIVE-FAULT');res.end(JSON.stringify({version:'0.35.0'}));});
server.listen(Number(port),host,()=>console.error('Listening on '+host+':'+port));
process.on('SIGTERM',()=>server.close());\n`, {mode: 0o755});
  const driver = path.join(dir, 'driver.mjs');
  fs.writeFileSync(driver, `
import fs from 'node:fs';import path from 'node:path';import {setTimeout as pause} from 'node:timers/promises';
import {withOwnedOllama} from './package/src/runtime/ollama.mjs';import {runProcess} from './package/src/runtime/process.mjs';
const dir=import.meta.dirname,fault=${JSON.stringify(fault)},run=path.join(dir,'run');
const write=fs.writeFileSync,rename=fs.renameSync,append=fs.appendFileSync;
const realKill=process.kill;process.kill=(pid,signal)=>{try{const result=realKill(pid,signal);append(path.join(dir,'signals.jsonl'),JSON.stringify({pid,signal,ok:true,time:Date.now()})+'\\n');return result;}catch(e){append(path.join(dir,'signals.jsonl'),JSON.stringify({pid,signal,error:e.code,time:Date.now(),stack:e.stack})+'\\n');throw e;}};
fs.renameSync=(from,to)=>{if(path.basename(to)==='server-owner.json'){write(path.join(dir,'observed-pid.json'),fs.readFileSync(from));if(fault==='owner')throw Error('INJECTED_OWNER_IO');}return rename(from,to);};
fs.appendFileSync=(file,bytes,...rest)=>{if(path.basename(file)==='server.log'&&(fault==='startup-log'||(fault==='active-log'&&String(bytes).includes('ACTIVE-FAULT'))))throw Error('INJECTED_LOG_IO');return append(file,bytes,...rest);};
const groupAlive=pid=>{try{process.kill(-pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
let error;
try{await withOwnedOllama({binary:path.join(dir,'ollama'),models:path.join(dir,'models'),directory:run,runtimeHome:path.join(dir,'home'),version:'0.35.0'},async({baseUrl,signal})=>{
 if(fault!=='active-log')throw Error('UNEXPECTED_WORK');
 const marker=path.join(dir,'work-pid');
 const work=runProcess(process.execPath,['-e',"require('fs').writeFileSync("+JSON.stringify(marker)+",String(process.pid));setInterval(()=>{},1000)"],{signal,timeoutMs:8000}).catch(e=>e);
 const deadline=Date.now()+3000;while(!fs.existsSync(marker)&&Date.now()<deadline)await pause(10);
 if(!fs.existsSync(marker))throw Error('WORK_START_DEADLINE');
 await fetch(baseUrl+'/emit');const result=await work;
 write(path.join(dir,'work-outcome.json'),JSON.stringify({error:result.message,...result.record}));
 if(result instanceof Error)throw result;
 write(path.join(dir,'READY'),'must not publish');
 });}catch(e){error=e.message;write(path.join(dir,'caught-error.json'),JSON.stringify({error,stack:e.stack}));}
const owner=JSON.parse(fs.readFileSync(path.join(dir,'observed-pid.json'))),groupEmpty=!groupAlive(owner.pid);
write(path.join(dir,'fault-result.json'),JSON.stringify({error,groupEmpty,ready:fs.existsSync(path.join(dir,'READY'))}));
// The probe alone reaps leaked owned fixtures on RED; this is never product cleanup evidence.
if(!groupEmpty)process.kill(-owner.pid,'SIGKILL');
`);
  t.after(() => {
    for (const name of ['observed-pid.json', 'work-pid']) {
      const file = path.join(dir, name); if (!fs.existsSync(file)) continue;
      const pid = name.endsWith('.json') ? JSON.parse(fs.readFileSync(file)).pid : Number(fs.readFileSync(file));
      if (alive(pid)) process.kill(-pid, 'SIGKILL');
    }
    if (!process.env.INSTALLER_TEST_EVIDENCE) fs.rmSync(dir, {recursive: true, force: true});
  });
  let outcome;
  try { outcome = await runProcess(process.execPath, [driver], {timeoutMs: 15000}); }
  catch (e) { outcome = {...e.record, error: e.message}; }
  fs.writeFileSync(path.join(dir, 'driver-outcome.json'), JSON.stringify(outcome, null, 2));
  assert.equal(outcome.code, 0, outcome.stderr); assert.equal(outcome.signal, null);
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'fault-result.json')));
  assert.match(result.error, /INJECTED_(?:OWNER|LOG)_IO/); assert.equal(result.groupEmpty, true, JSON.stringify(result)); assert.equal(result.ready, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'run/server-outcome.json'))).groupEmpty, true);
  if (fault === 'active-log') {
    const work = JSON.parse(fs.readFileSync(path.join(dir, 'work-outcome.json'))); assert.match(work.error, /CANCELLED/); assert.ok(['SIGTERM', 'SIGKILL'].includes(work.signal));
    assert.equal(alive(Number(fs.readFileSync(path.join(dir, 'work-pid')))), false);
  }
});
