import {after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each test file has its own process. Never leave approvals in a real user store.
const before = process.env.XDG_STATE_HOME;
const state = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'traverse-test-approvals-')));
process.env.XDG_STATE_HOME = state;
after(() => {
  if (before === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = before;
  fs.rmSync(state, {recursive: true, force: true});
});
