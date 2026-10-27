import path from 'node:path';
import {root, options, prerequisites, checks} from './check-support.mjs';

let check;
try {
  const args = options('Usage: npm run check -- [--out FRESH_DIRECTORY]\nRun serial package tests, headless Expo checks and an installed-package smoke. Requires both locked dependency installs; see CONTRIBUTING.md.');
  if (args) {
    const npm = prerequisites({full: true}); check = checks('full', args.out);
    const run = (label, args, cwd = root, timeoutMs = 120000) => check.run(label, process.execPath, [npm, ...args], {cwd, timeoutMs});
    await run('package-tests', ['test'], root, 900000);
    const example = path.join(root, 'examples/expo');
    await run('example-types', ['run', 'typecheck'], example);
    await run('example-lint', ['run', 'lint'], example);
    await run('example-snapshots', ['test'], example);
    await run('example-web-export', ['run', 'export:web'], example, 300000);
    await run('installed-package', ['run', 'check:package', '--', '--out', path.join(check.out, 'package')], root, 300000);
    check.finish();
  }
} catch (error) {
  if (check) check.finish(error);
  else { console.error(error.message); process.exitCode = 1; }
}
