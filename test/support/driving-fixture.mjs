import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

export function drivingFixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wayfinder-driving-cli-')));
  if (t) t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  for (const name of ['app', 'components', 'app.json', 'tsconfig.json', 'package.json', 'package-lock.json', 'node_modules/expo/package.json', 'node_modules/expo-router/package.json']) {
    const to = path.join(project, name); fs.mkdirSync(path.dirname(to), {recursive: true});
    fs.cpSync(path.join(packageRoot, 'examples/expo', name), to, {recursive: true});
  }
  const executable = path.join(root, 'agent-device'), log = path.join(root, 'calls.jsonl'), state = path.join(root, 'ui-state.json'), fault = path.join(root, 'fault.txt');
  fs.writeFileSync(executable, `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2), session=args[args.indexOf('--session')+1], op=args[0];
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,pid:process.pid})+'\\n');
if(op==='--version'){console.log('0.21.4');process.exit(0);}
const file=${JSON.stringify(state)}, all=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const ui=all[session]??{name:'',saved:false,active:false};
const reply=data=>console.log(JSON.stringify({success:true,data}));
const mode=fs.existsSync(${JSON.stringify(fault)})?fs.readFileSync(${JSON.stringify(fault)},'utf8'):'';
if(mode==='hang-open'&&op==='open'||mode==='hang-post'&&op==='snapshot'&&ui.saved){setInterval(()=>{},1000);}
else{
if(op==='open')ui.active=true;
if(op==='close')ui.active=false;
if(op==='fill'){if(!ui.active)throw Error('No active target');ui.name=args[2];}
if(op==='press'){if(!ui.active)throw Error('No active target');ui.saved=true;ui.committed=ui.name;}
if(op==='record'&&args[1]==='start'){ui.recording=args[2];fs.writeFileSync(args[2],'offline fixture media');}
if(op==='screenshot')fs.writeFileSync(args[1],'offline fixture image');
all[session]=ui;fs.writeFileSync(file,JSON.stringify(all));
if(op==='snapshot'){const nodes=[{index:0,role:'heading',hittable:false,label:ui.saved?'Saved':'Edit profile'},{index:1,role:'textbox',hittable:true,label:'Name',value:ui.name,ref:'e1'},{index:2,role:'button',hittable:true,label:'Save',ref:'e2'}];reply({nodes:args.includes('-i')?nodes.filter(n=>n.hittable):nodes});}
else if(op==='devices')reply({devices:[{id:'TEST-UDID',platform:'ios',state:'shutdown'}]});
else reply({message:'acknowledged'});
}
`, {mode: 0o755});
  const frontier = path.join(root, 'frontier.mjs'), config = path.join(root, 'frontier.json');
  fs.writeFileSync(frontier, `import fs from 'node:fs';const request=JSON.parse(fs.readFileSync(0,'utf8'));const picked=request.options.find(o=>o.description.startsWith('Fill'))??request.options[0];console.log(JSON.stringify({pick:picked.id,usage:{inputTokens:10,outputTokens:1},costUsd:0.001}));`);
  fs.writeFileSync(config, JSON.stringify({schema: 'wayfinder-frontier-command/1', command: process.execPath, args: [frontier]}));
  const task = path.join(root, 'task.json'); fs.writeFileSync(task, JSON.stringify({goal: 'Save the profile name', inputs: {Name: 'Updated'}, expect: {visible: [{label: 'Saved'}], fields: [{label: 'Name', value: 'Updated'}]}}));
  return {root, project, executable, log, state, fault, config, task};
}
