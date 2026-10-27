# Try Traverse with Expo

A four-route Expo Router app with one synthetic field note. Browse → open → edit → Save or Cancel. Use it to try Traverse installation and maintain an inventory from real source files.

The sample has no embedded Traverse SDK or model. The installed CLI generates its source graph; UI driving uses the external agent-device runner. No backend, account or EAS project is needed. Native UI validation coverage is tracked in the [driving guide](../../docs/driving.md), separately from configuration health.

## Run the app yourself

From the Traverse package root, with Node 22.13+ (verified with 22.21.1) and npm:

```sh
cd examples/expo
npm ci
npm run web
```

`web` starts Expo and opens your browser. For Expo Go, use `npm start` instead and scan the QR code with a compatible Expo Go client. These are manual commands; automated verification only exported web assets and did not open a browser or device.

This sample pins Expo SDK 57: Expo 57.0.30, Router 57.0.28, React Native 0.86.3, React 19.2.3 and Expo UI 57.0.25 in `package-lock.json`. Expo's [setup guide](https://docs.expo.dev/get-started/create-a-project/) recommends SDK 57 for Expo Go during the SDK 58 transition. The actual unqualified scaffold selected SDK 58, so this sample was created explicitly with:

```sh
npx create-expo-app@latest examples/wayfinder-expo --template default@sdk-57 --yes --no-install
```

The observed create-expo-app wrapper was 5.0.0 and the SDK 57 template archive was expo-template-default 57.0.32. The starter was simplified to root `app/` with `@/*` → `./*`, deliberately matching Traverse's current contract. Expo supports [root app and src/app](https://docs.expo.dev/router/reference/src-directory/). Controls use the SDK 57 [universal Expo UI API](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/). Keep the supplied lockfile; Reanimated 4.5.1 and Worklets 0.10.1 retain the compatible template pairing.

### Manual acceptance sequence

1. Home → **Browse notes** → **Open Garden walk**. Expect “Bring a notebook on the garden walk.”
2. **Edit note**. Replace the text with “Bring water.” → **Save**. Expect the detail page to show “Bring water.”
3. **All notes**. Expect the list to show “Bring water.” Open it and edit again; replace the text with “Discard this.” → **Cancel**.
4. Expect the detail and list still to show “Bring water.” Reopen Edit; expect the saved text, not the cancelled draft.
5. Reload the page or fully restart the app. Expect the original notebook text. State is session-only; there is no storage or network. Browser back/forward is ordinary Router navigation, not a Traverse action.

Typechecking/export do not prove this interaction sequence. Mobile keyboard, safe-area and native controls still need manual testing on the user's chosen device.

## Set up Traverse in this sample

Install the local Traverse archive once using the [package instructions](../../README.md). With `traverse` available on PATH, enter this directory and run:

```sh
traverse init
traverse graph check
traverse doctor
traverse graph watch
```

Traverse creates portable `.wayfinder/project.json`, `.wayfinder/extractor/artifact.json` and `.wayfinder/graph.json` automatically. A second init preserves compatible config. Commit these artifacts and the generated ignore rules; local approvals, logs and old install folders stay ignored. An existing schema-1 config needs `traverse init --migrate`, which preserves its original bytes in local state. Source edits make `graph check` and doctor fail until refresh; watch refreshes on changes and stops with Ctrl-C. Graph generation requires no model. Interactive `traverse init` also opens the arrow-key provider/model/effort and driving-defaults wizard before any project writes. Cancelling leaves project files unchanged; `init --no-interactive` generates only the graph. It saves `.wayfinder/settings.json`; edit that file or rerun the wizard to update defaults. App instances and recording are per run. See the [project setup guide](../../docs/project-setup.md). Optional `traverse setup` installs pinned Ollama/tev1 once per machine; `doctor --model` explicitly tests inference. The sample needs no Git root or nested `.git`. This setup uses the supported static SDK57/root-app profile; native driving remains unavailable.

For checkout development, the advanced alternative is `../../install.sh --prefix "$PWD/.wayfinder/tool"`, then use its printed full command. Choose an unused prefix: `--prefix` selects the tool-install location, while `init` configures the current project; `--node` is an optional runtime override. This launcher requires its source checkout to remain available. The parser lock is `../../npm-shrinkwrap.json`. Preserve an existing installation and choose a fresh prefix when its recorded source identity changes.

Doctor exit 0 means applicable configuration checks passed; 1 means a configuration or invocation failure. Its JSON reports `readiness.configuration` separately from `readiness.extractor`. Native UI test history is not a doctor check. Checkout launchers use `doctor --project .` for project checks. Structured output is available with `--json`.

## Advanced snapshot, inspect, review and accept

With the installed command on PATH, still in the sample directory:

```sh
RUN="$(mktemp -d "$PWD/.wayfinder/run.XXXXXX")"
traverse snapshot --out "$RUN/snapshot"
traverse extractor prepare --spec "$RUN/snapshot/spec.json" --out "$RUN/request"
traverse extractor reference --request "$RUN/request/request.json" --out "$RUN/artifact.json"
traverse extractor inspect --artifact "$RUN/artifact.json"
```

The helper reads only this sample's `app/` and `components/`, plus static app/alias/package configuration and installed/locked Expo/Router metadata. `provenance.json` records exact hashes and included files. `source.revision` is a content hash, **not a Git commit or installed build identity**. Missing sources/dependencies, incompatible versions, alternate route roots/config, symlinks and non-source inputs fail explicitly. The runtime snapshot supports the explicit static profile; the sample-only helper remains available as `npm run snapshot`.

`reference` uses the existing deterministic Expo extractor; **no agent generation occurs**. Read every artifact file and declared dependency, plus the reference substrate in `../../src/source/navigation.mjs`. `inspect` prints the exact artifact hash. Only after inspecting and trusting those bytes, replace both placeholders below:

```sh
traverse extractor review --artifact "$RUN/artifact.json" \
  --hash HASH_YOU_REVIEWED --reviewer YOUR_NAME --trust-host --out "$RUN/review.json"
traverse extractor accept --request "$RUN/request/request.json" \
  --artifact "$RUN/artifact.json" --review "$RUN/review.json" --out "$RUN/accepted"
traverse extractor refresh --request "$RUN/request/request.json" \
  --accepted "$RUN/accepted/accepted.json" --out "$RUN/refreshed"
```

The trust flag authorizes local host execution; the cache is not a sandbox. User instructions never auto-approve an artifact. Automated verification used a named test reviewer solely for the known reference wrapper in disposable output.

Expected source inventory: `/`, `/notes`, `/notes/first`, `/notes/edit`, with seven explicit navigation edges. `accepted/graph.json` contains actual file/line/hash provenance. The current extractor returns `label: null` for all seven Expo UI Button edges; route targets and source excerpts are retained, but this is not a label/selector or native UI mapping. The Save edge includes a state-changing callback, so it is not pure navigation; an edge is not proof that data was saved. This `traverse-navigation` (schema version 1) partial static inventory does not represent runtime visibility, keyboard state, UI effects or native action targets. History/dynamic/helper-call limitations remain explicit in the existing contract.

Normally use `traverse graph refresh` or watch for source changes; they call no author. The manual pipeline can also create a new `RUN`, snapshot/prepare again and pass earlier `accepted.json` to `extractor refresh`. Framework/config/contract/dependency changes require revalidation or renewed acceptance. Keep the previous receipts.

## Checks and cleanup

```sh
npm run typecheck
npm run lint
npm test
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 npm run export:web
```

Export writes ignored `dist/`; it starts no browser/device. Snapshot tests use disposable source fixtures. Dependencies, `.expo/`, exports and local `.wayfinder` state are ignored; the portable config/extractor/graph are intended for Git. Stop only the dev server you started with Ctrl-C. After reviewing ownership and preserving receipts you need, remove this sample's `.wayfinder/`, `dist/`, `.expo/` and `node_modules/` to clean up. No global command, shell profile or production app checkout was changed.

See the [adoption guide](../../docs/adoption.md) for the broader host-side design and remaining application integration work.
