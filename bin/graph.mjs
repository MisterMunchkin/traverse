import {parseArgs} from 'node:util';
import {checkGraph, refreshGraph, watchGraph} from '../src/graph.mjs';
import {helpText, progress} from '../src/presentation.mjs';

export async function graphMain(args, {signal} = {}) {
  const mode = args[0];
  if (mode === '--help' || mode === undefined) { console.log(helpText()); return; }
  if (!['refresh', 'check', 'watch'].includes(mode)) throw Error('Unknown graph command; use refresh, check or watch');
  const {values: v} = parseArgs({args: args.slice(1), options: {project: {type: 'string'}, accepted: {type: 'string'}, json: {type: 'boolean'}, help: {type: 'boolean'}}});
  if (v.accepted && mode !== 'refresh') throw Error('--accepted is supported only for graph refresh');
  if (v.help) { console.log(helpText()); return; }
  if (mode === 'watch') {
    if (!v.json) console.error('Traverse · Watching graph inputs; Ctrl-C stops this watcher');
    await watchGraph({project: v.project, signal, onEvent: event => {
      if (v.json) console.log(JSON.stringify(event));
      else console.error(event.ready ? '  ✓ Graph ready · ' + event.sourceFingerprint : '  ! Graph stale · ' + event.reason);
    }});
    if (v.json) console.log(JSON.stringify({schema: 'wayfinder-graph-watch-event/1', status: 'stopped'}));
    return;
  }
  const result = mode === 'check' ? await checkGraph(v.project, {signal}) : await refreshGraph({project: v.project, accepted: v.accepted, signal, onProgress: progress(v.json)});
  if (v.json) console.log(JSON.stringify(result));
  else console.error(`Traverse · ${result.ready ? 'Graph ready' : 'Graph stale or unavailable'}\n  Graph: ${result.graph}\n${result.reason ? '  ' + result.reason + '\n  Next: traverse graph refresh\n' : ''}`);
  process.exitCode = result.exitCode;
}
