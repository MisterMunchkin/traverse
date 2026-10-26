#!/usr/bin/env node
import fs from 'node:fs';
import {parseArgs} from 'node:util';
const args=process.argv.slice(2), json=args.includes('--json');
let prefix=null,mode;
let interrupted=0,controller,stopInt,stopTerm;
try {
  if(args[0]==='--installation') {prefix=args[1];if(!prefix)throw Error('Installation prefix required');args.splice(0,2);}
  mode=args.shift();
  if(['setup','graph','init','device','session','drive'].includes(mode)||(mode==='doctor'&&args.includes('--model'))) {
    controller=new AbortController();stopInt=()=>{interrupted=130;controller.abort();};stopTerm=()=>{interrupted=143;controller.abort();};
    process.once('SIGINT',stopInt);process.once('SIGTERM',stopTerm);
  }
  if(!mode||mode==='--help'||mode==='--version') {
    if(args.length)throw Error('Unexpected arguments; run traverse --help');
    const {helpText,versionText}=await import('../src/presentation.mjs');
    console.log(mode==='--version'?versionText(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version):helpText());
  } else if(mode==='setup') {
    const {setupMain}=await import('./setup.mjs');await setupMain(args,{signal:controller.signal});
  } else if(mode==='init') {
    const {shellQuote}=await import('../src/presentation.mjs');
    const {initMain}=await import('./init.mjs');await initMain(args,{signal:controller.signal,command:prefix?shellQuote(prefix+'/bin/traverse'):'traverse',installationPrefix:prefix});
  } else if(mode==='graph') {
    const {graphMain}=await import('./graph.mjs');await graphMain(args,{signal:controller.signal});
  } else if(['device','session','drive'].includes(mode)) {
    if(prefix){const {doctor}=await import('../src/installation.mjs');const report=await doctor(prefix);if(!report.readiness.extractor)throw Error('Installation source changed; inspect doctor before driving');}
    const {drivingMain}=await import('./driving.mjs');await drivingMain(mode,args,{signal:controller.signal});
  } else if(mode==='extractor') {
    const {doctor,runtimeDoctor,doctorText}=await import('../src/installation.mjs');
    const report=prefix?await doctor(prefix):await runtimeDoctor();
    if(!report.readiness.extractor)throw Error(doctorText(report,json?{stream:{isTTY:false}}:undefined));
    const {extractorMain}=await import('./extractor-pipeline.mjs');await extractorMain(args);
  } else {
    const {values:v}=parseArgs({args,options:{project:{type:'string'},json:{type:'boolean'},check:{type:'boolean'},'dry-run':{type:'boolean'},migrate:{type:'boolean'},model:{type:'boolean'},'cache-dir':{type:'string'},out:{type:'string'},help:{type:'boolean'}}});
    const allowed={doctor:['project','json','model','cache-dir','help'],snapshot:['project','json','out','help'],'extractor-preflight':[]}[mode];
    if(!allowed||(!prefix&&mode==='extractor-preflight'))throw Error(`Unknown command ${mode}; run traverse --help`);
    if(Object.keys(v).some(k=>!allowed.includes(k)))throw Object.assign(Error(`Unsupported option for ${mode}; run traverse --help`), {code:'WAYFINDER_USAGE'});
    if(v.help){const {helpText}=await import('../src/presentation.mjs');console.log(helpText());}
    else {
      const {doctor,runtimeDoctor,doctorText,finalizeDoctor}=await import('../src/installation.mjs');
      if(mode==='doctor'||mode==='extractor-preflight') {
        const report=prefix?await doctor(prefix):await runtimeDoctor();
        if(mode==='doctor'&&(!prefix||v.project)) {
          try {
            const {projectStatus}=await import('../src/project.mjs');const p=projectStatus(v.project);report.checks.push({name:'project-config',status:'pass',severity:'required',evidence:{root:p.root,framework:p.config.framework},remediation:null});
            const {checkGraph}=await import('../src/graph.mjs');const graph=await checkGraph(p.root,{signal:controller?.signal});
            report.checks.push({name:'project-graph',status:graph.ready?'pass':'fail',severity:'required',evidence:graph.ready?{graph:graph.graph,sourceFingerprint:graph.sourceFingerprint}:graph.reason,remediation:graph.ready?null:'Run traverse graph refresh'});
            if(!graph.ready)report.readiness.extractor=false;
            try {
              const {readSettings,resolveProviderExecutable,settingsPath}=await import('../src/settings.mjs');const settings=readSettings(p.root);
              if(settings){const executable=resolveProviderExecutable(settings.frontier.provider);report.checks.push({name:'project-frontier',status:'pass',severity:'required',evidence:{settingsFile:settingsPath(p.root),frontier:settings.frontier,driving:settings.driving,executable},remediation:null});}
            }catch(e){report.checks.push({name:'project-frontier',status:'fail',severity:'required',evidence:e.message,remediation:'Inspect .wayfinder/settings.json or rerun traverse init; install/sign in to the selected CLI'});}
          }
          catch(e){report.checks.push({name:'project-config',status:'fail',severity:'required',evidence:e.message,remediation:'Run traverse init in the supported project, or select it with --project'});report.readiness.extractor=false;}
        }
        if(mode==='doctor') {
          const {shellQuote}=await import('../src/presentation.mjs');
          const cacheOption=v['cache-dir']!==undefined ? ' --cache-dir '+shellQuote(v['cache-dir']) : '';
          try {
            const {runtimeStatus,checkModel,DEFAULT_MODEL_CACHE}=await import('../src/model-setup.mjs');
            if(v.model||v['cache-dir']!==undefined||fs.lstatSync(DEFAULT_MODEL_CACHE,{throwIfNoEntry:false})) {
              const model=await(v.model?checkModel:runtimeStatus)({cacheDir:v['cache-dir'],signal:controller?.signal});
              const ready=v.model?model.decisionReady:model.ready;
              report.checks.push({name:v.model?'managed-model-decision':'managed-model-installation',status:ready?'pass':'fail',severity:'required',evidence:{model:model.model?.name,ready:!!ready,contentVerified:model.contentVerified,reason:model.reason??null},remediation:ready?null:'Run traverse setup'+cacheOption});
            }
          } catch(e){report.checks.push({name:'managed-model',status:'fail',severity:'required',evidence:interrupted?'Model check cancelled':e.message,remediation:'Inspect managed setup with traverse setup --check'+cacheOption});}
        }
        Object.assign(report,finalizeDoctor(report));
        report.exitCode=interrupted||(mode==='extractor-preflight'?(report.readiness.extractor?0:1):report.exitCode);
        if(mode==='doctor'){if(v.json)console.log(JSON.stringify(report));else console.error(doctorText(report));}
        else if(report.exitCode)console.error(doctorText(report));
        process.exitCode=report.exitCode;
      } else {
        if(prefix){const r=await doctor(prefix);if(!r.readiness.extractor)throw Error('Installation is not ready; run the recorded Traverse doctor before project setup');}
        const {snapshotProject}=await import('../src/project.mjs');
        const {shellQuote}=await import('../src/presentation.mjs');
        const command=prefix?shellQuote(prefix+'/bin/traverse'):'traverse';
          if(!v.out)throw Error('--out NEW_DIRECTORY required');
          const result=snapshotProject(v.project,v.out);
          if(v.json)console.log(JSON.stringify(result));else console.error(`Traverse · Snapshot ready\n  Spec: ${result.spec}\n  Next: ${command} extractor prepare --spec ${shellQuote(result.spec)} --out NEW_REQUEST_DIRECTORY`);
      }
    }
  }
} catch(e) {
  if(e.code==='CANCELLED')interrupted||=130;
  if(json) {
    if(mode==='doctor'||mode==='extractor-preflight') {
      const usage=e.code?.startsWith('ERR_PARSE_ARGS')||e.code==='WAYFINDER_USAGE';
      console.log(JSON.stringify({schema:'wayfinder-doctor/2',readiness:{extractor:false,configuration:false},checks:[{name:usage?'command-options':'launcher-startup',status:'fail',severity:'required',evidence:usage?e.message:'Required runtime modules or invocation are unavailable',remediation:usage?'Run traverse doctor --help; doctor checks configuration only':'Restore the recorded installation or reinstall the package'}],exitCode:1}));
    }
    else console.log(JSON.stringify({schema:mode==='init'?'wayfinder-init/2':mode==='setup'?(args.some(x=>x==='--project'||x.startsWith('--project='))?'wayfinder-project-setup/1':'wayfinder-setup/1'):mode==='graph'?(args[0]==='watch'?'wayfinder-graph-watch-event/1':'wayfinder-graph-result/1'):mode==='session'?'wayfinder-session-result/1':mode==='device'?'wayfinder-device-result/1':mode==='drive'?'wayfinder-drive-result/1':'wayfinder-command-result/1',ready:false,error:interrupted?'CANCELLED':e.message,...(e.actionEvidence?{action:e.actionEvidence}:{}),exitCode:interrupted||1}));
  } else console.error(`Traverse: ${e.message}`);
  process.exitCode=interrupted||1;
} finally {
  if(stopInt)process.removeListener('SIGINT',stopInt);if(stopTerm)process.removeListener('SIGTERM',stopTerm);
  if(interrupted)process.exitCode=interrupted;
}
