# Next extraction fixture

Synthetic Next 16.4.6 / React 19.2.9 App Router app, independent of the website and Expo example. It exercises grouped routes and a concrete link to a dynamic page. Install locally with `npm ci --prefix fixtures/next-app --ignore-scripts --no-audit --no-fund` from the Traverse root.

Use the managed author/review setup from [adapters](../../docs/adapters.md#review-and-pin), or prepare the shipped deterministic reference for inspection:

```sh
node --input-type=module - <<'JS'
import fs from 'node:fs';
import {inspectProject} from './src/project.mjs';
import {createRequest,referenceArtifact,artifactHash} from './src/extractor-pipeline/pipeline.mjs';
const artifact=referenceArtifact(createRequest(inspectProject('fixtures/next-app').spec));
fs.writeFileSync('/tmp/traverse-next-adapter.json',JSON.stringify(artifact,null,2));
console.log(artifactHash(artifact));
JS
```

Inspect `/tmp/traverse-next-adapter.json` and the pinned source it imports. Then use the printed exact hash:

```sh
node bin/traverse.mjs init --project fixtures/next-app --adapter /tmp/traverse-next-adapter.json --trust-adapter ACTUAL_HASH --json
node bin/traverse.mjs graph check --project fixtures/next-app --json
npm run dev --prefix fixtures/next-app -- --port 3187
```

In another terminal, exercise the existing browser path (requires `agent-device web setup` and `agent-device web doctor` to succeed):

```sh
node bin/traverse.mjs session open --project fixtures/next-app --session next-browser --platform web --app http://127.0.0.1:3187 --json
node bin/traverse.mjs session observe --project fixtures/next-app --session next-browser --json
```

Write an action JSON using the returned observation ID and enabled `Open project` control ID, then `session act --project fixtures/next-app --session next-browser --action /absolute/action.json --json`. Verify `Project 42` in the returned observation; follow `Home` and `Settings` using fresh observations. Finish with `session close --project fixtures/next-app --session next-browser --json` and stop the owned dev server. These manual instructions are not a claim of passed browser QA.

Expected graph: `/`, `/projects/[id]`, `/(account)/settings`; URLs `/`, `/projects/[id]`, `/settings`. Four edges: Home → Project, Home → Settings, Project → Home, Settings → Home; no unresolved targets. The navigation inventory remains `traverse-navigation`, `schemaVersion: 1`, `partial-static-source`. Expanded dynamic/guard/uncertainty cases live in the host-owned `fixtures-next.mjs` conformance set and `test/next-extraction.test.mjs`.
