#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {progress, installText} from '../src/presentation.mjs';
const help = `Checkout-based Traverse setup (no model/device/global tool installation)
./install.sh [--prefix ABS_PATH] [--node ABS_NODE] [--npm ABS_NPM]
             [--project ABS_READ_ONLY_CHECKOUT] [--timeout-ms 120000]
             [--check|--dry-run] [--json] [--verbose]
Default prefix: ~/.local/share/traverse. Check/dry-run make no setup changes.
Then: PREFIX/bin/traverse init (inside a supported Expo project)
      PREFIX/bin/traverse doctor [--json]
      PREFIX/bin/traverse extractor <existing extractor-pipeline arguments>
Doctor exit 0: configuration ready; 1: configuration or invocation failure.`;
let json = process.argv.includes('--json');
try {
  const {install} = await import('../src/installation.mjs');
  const {values: v} = parseArgs({options: {prefix: {type:'string'}, node:{type:'string'}, npm:{type:'string'}, project:{type:'string'}, 'timeout-ms':{type:'string'}, check:{type:'boolean'}, 'dry-run':{type:'boolean'}, json:{type:'boolean'}, verbose:{type:'boolean'}, help:{type:'boolean'}}});
  if (v.help) { console.log(help); process.exit(0); }
  if (v.check && v['dry-run']) throw Error('Choose --check or --dry-run');
  const result = await install({prefix:v.prefix,node:v.node,npm:v.npm,project:v.project,timeoutMs:v['timeout-ms'],check:v.check,dryRun:v['dry-run'],onProgress:progress(json)});
  if(json)console.log(JSON.stringify(result));else console.error(installText(result,{verbose:v.verbose}));
  process.exitCode = result.exitCode;
} catch (e) {
  const result = {schema:'wayfinder-install-result/2',ready:false,error:e.message,exitCode:1};
  if(json)console.log(JSON.stringify(result));else console.error(`Traverse install failed: ${e.message}\nInspect the selected installation and retry; use --verbose for setup details.`); process.exitCode=1;
}
