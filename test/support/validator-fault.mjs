// Test-only loader: keep the production deadline and process cleanup, replace only the validator child.
import {mock} from 'node:test';
import * as runtime from '../../src/runtime/process.mjs';
mock.module(new URL('../../src/runtime/process.mjs', import.meta.url).href, {namedExports: {...runtime,
  runProcess: (command, args, options) => {
    if (!args[0]?.endsWith('validate-worker.mjs')) return runtime.runProcess(command, args, options);
    const script = process.env.TRAVERSE_TEST_VALIDATOR_FAILURE === 'timeout'
      ? 'process.stdin.resume(); setInterval(() => {}, 1000)'
      : 'process.stdin.resume(); process.exitCode = 1';
    return runtime.runProcess(command, ['-e', script], options);
  },
}});
