# Traverse: local extractor pipeline and app adoption

Traverse can prepare an authoring request, review and validate an extractor, pin it, and refresh a source inventory without an LLM. **It is not installed into an external app or agent-device.** Only the existing Expo source profile is supported. Real agent generation and real CV/native driving remain unverified.

Traverse is the installed product name, independent of model choice. `projects/traverse` is the maintained private package; `mobile-agent-lab` and `tools/tev1-lab` retain the research and historical studies. The package also works when copied, including its lockfile, into a stable owned directory outside the lab. Historical reports and command receipts retain their original names.

## Project setup with the installed package

The private local archive provides `traverse` through npm's normal executable entry. See the [package README](../README.md) for the exact install command. Nothing is published to a registry, and automation installs only into isolated owned prefixes.

Inside a supported static SDK57/root-app Expo project, run `traverse init`, `traverse graph check`, then `traverse graph watch` during development. Init writes portable schema-2 config, the bundled extractor artifact and an initial graph; compatible reruns preserve config bytes, including beside an existing tool prefix. For schema-1 configuration use `init --migrate`, which saves the original bytes under ignored local state. Commit project config, extractor and graph; local trust/execution receipts remain ignored. Init adds a delimited allowlist to the selected project’s ignore file and never edits ancestor files. Snapshots remain available with `traverse snapshot --out .wayfinder/snapshots/first`. `--project DIRECTORY` is explicit and does not search other checkouts. The bounded snapshot carries source and routing/package hashes; it is not a Git/build/runtime identity. Unsupported dynamic configuration is rejected without execution.

Project checks, read-only init modes, plain stderr progress and stdout JSON are covered by process tests. Package doctor checks runtime/source availability and trusted extraction; checkout doctor additionally compares its recorded installation pins. Only the exact bundled reference is automatically accepted. Neither project setup nor doctor approves an unknown extractor. Use the unchanged explicit hash review below before execution, then `graph refresh --accepted /absolute/accepted.json` to bind that reviewed artifact locally. A copied custom artifact needs local acceptance before execution.

## What runs now

The repository commands publish `.wayfinder/graph.json` as a single atomic `wayfinder-repository-graph/1` envelope binding source/configuration/extractor/generator fingerprints to the inventory. `graph check` recomputes source and trusted reference equivalence without executing an unknown artifact. `graph refresh` reuses acceptance and makes zero author calls. `graph watch` serializes debounced refreshes, preserves the last valid graph on failure and closes watchers/owned processes on interruption. In JSON mode watch streams NDJSON ready/stale/stopped events; other commands emit one result.

The low-level CLI remains `bin/extractor-pipeline.mjs`. It returns `cv-navigation/1`, a partial static source inventory. Guards, hidden registrations, source locations/hashes, ambiguous/dynamic/history targets and limitations stay explicit. It cannot establish visible controls, enabled actions, app state, business effects or backend truth.

V1 requires normalized equivalence to the pinned existing Expo reference on every execution. Fixed, handwritten miniature expectations independently test routes, aliases, ownership, guards, hidden registrations and uncertainties. This intentionally certifies the current Expo inventory profile; authoring a different framework requires a separately owned contract and conformance expansion. It does not certify arbitrary framework adapters.

The existing `cv-navigation-cases.mjs` makes **synthetic** CV fixtures. `browser/observation.mjs` projects DOM buttons/textboxes and synthetic semantics; it is not a native CV snapshot adapter. `browser/run.mjs` is an experimental host study runner with private artifact paths and explicit budgets, not a production installer or an agent-device extension. The browser checkpoint demonstrates only its stated fixture workload.

## Host prerequisites and pins

Run from the Traverse package root (`projects/traverse` in the lab). The private package requires Node >=22.11 and pins TypeScript 6.0.3 in its own manifest and lockfile. The Expo example has its own higher Node requirement and separate dependency lock. No runtime code or dependency is read from lab tools.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node bin/extractor-pipeline.mjs --help
npm test
```

Device/model tooling is unnecessary for these commands. For a later authorized UI pilot, the locally declared agent-device package is 0.21.4, Node >=22.12; its installed README requires **Node 24+ for web automation**. The lab's Node 22 study runner and agent-device web subprocess must therefore have separately verified compatible runtimes. The existing launcher is `~/.local/bin/agent-device`; do not replace its global installation as part of this pipeline. Read the shared agent-device skill and bootstrap instructions at pilot time and pin the actual binary/package/hash, runtime and session capabilities. No invented plugin/install flags are required.

`traverse setup` explicitly installs managed Ollama 0.40.8 and `tev1:4b-q8_0` in `~/.cache/wayfinder` once per machine. The first managed platform is macOS arm64. The runtime archive SHA-256 is `29fce20c736f62aa8885b1e83552c5fd8dcc63edc5ffc1b47f2de591a06cde44`; the model manifest digest is `7954dce22bc6c29c3b119656207681d12cb34434fed7caa086bfbc919bef0740`. All model blobs are checksum-verified, and an actual choice response is validated before ready publication. Setup downloads official assets without requiring any lab checkout or historical cache. A failed attempt saves its stage, error and receipt directory; doctor reports incomplete setup with those details. The multi-GB model is absent from the npm archive. `--cache-dir` selects an explicit owned location; `--runtime-archive` and `--models-dir` can import verified local assets. No other model service/cache is adopted or changed.

`setup --dry-run` previews without writes; `setup --check` checks installed pins without starting the model. Compatible setup reruns deeply verify and preserve installation metadata. Failed attempts retain diagnostics in cache `runs/`; stale locks and conflicting published/partial caches are refused rather than taken over. Preserve those receipts and choose a fresh cache after a conflicting partial publication. Default `doctor` checks an existing or explicitly selected model cache without inference. It omits an unconfigured optional model and fails a configured/incomplete setup. `doctor --model` explicitly performs a bounded tiny constrained-choice request through its private owned runtime, then stops it; a missing/unusable model fails that explicit check. Graph commands require no model. No app-embedded model or SDK is needed.

## Checkout-based installation and doctor

The package-root `install.sh` is now a thin POSIX entrypoint to Node setup code. This is a developer installation referencing this exact checkout, which must remain available. It does not copy the repository, change PATH/shell profiles, install global tools or download models. Do not delete/move the checkout while using its launcher. Promotion verification uses disposable prefixes and an isolated package copy; no default-prefix or CV installation is performed. An earlier user-owned prototype installation remains pinned to its original checkout.

Choose an unused absolute user-owned prefix and a Node executable meeting the checked-in `>=22.11` engines. Paths with spaces, apostrophes and shell metacharacters remain literal arguments:

```sh
./install.sh --prefix /absolute/owned/traverse --node /absolute/path/to/node --dry-run --json
./install.sh --prefix /absolute/owned/traverse --node /absolute/path/to/node
/absolute/owned/traverse/bin/traverse doctor
/absolute/owned/traverse/bin/traverse doctor --json
/absolute/owned/traverse/bin/traverse extractor --help
```

Without `--prefix`, setup defaults to `~/.local/share/traverse`; without `--node`, it uses Node on PATH. Optional `--project /absolute/checkout` records only an explicitly selected read-only project; it does not scan or extract that project's source. The extractor still requires an explicit snapshot/spec. `--npm /absolute/path/to/npm` selects dependency tooling when needed. Missing/incompatible TypeScript triggers `npm ci` using the Traverse package lockfile, with lifecycle scripts disabled, an owned cache/config, a 120-second maximum deadline (`--timeout-ms 1..120000`) and receipts in `PREFIX/logs/`. It changes only the source checkout's parser dependency directory and the owned prefix. Failed setup remains marked `preparing` for diagnosis/retry. No model acquisition or authentication runs.

`--check` and `--dry-run` do not write files or invoke npm. `--check` exits 0 only for an existing compatible ready installation; otherwise 1. `--dry-run` exits 0 for a valid setup plan even when setup is needed. Both reject conflicts/stale ownership. Normal install returns 0 on success and 1 on failure. A missing bootstrap Node is reported by the shell before Node JSON output is possible.

Setup creates `PREFIX/bin/traverse`, `config.json`, and `installation.json`; dependency setup also creates only owned logs/cache/npm config files. Compatible reruns preserve config bytes exactly and report no created files. An unowned existing prefix, conflicting launcher or symlinked destination is refused. Use canonical paths (for example the physical path of a temporary directory). Source/dependency or Node changes require inspection and a fresh prefix, rather than silently replacing the pin.

The editable config is deliberately small; optional paths are null until explicitly configured:

```json
{
  "schema": "wayfinder-config/1",
  "project": null,
  "tools": {"agentDevice": null, "ollama": null, "frontier": null, "models": null}
}
```

`project` must be an available absolute checkout path, executables absolute file paths, and `models` an absolute directory. Doctor reads these paths without invoking optional tools or contacting services. It reports availability with `versionObserved: null` and `executed: false`; this is not proof that agent-device, Ollama, frontier or weights are usable/pinned. It checks the selected Node, declared/installed parser version, owned metadata, pinned executable/dependency hashes, config and a bounded trusted two-route offline extraction. The installed `extractor` command runs that preflight, then the POSIX launcher directly `exec`s the existing pipeline CLI. There is no additional outer timeout or detached supervisor: the pipeline retains its own author-attempt, candidate and validation budgets, streaming output, exit status and process ownership. Only the trusted reference smoke executes during doctor; unknown authored artifacts still require the existing exact-hash review boundary.

Doctor reports configuration health, not native test history. `wayfinder-doctor/2` exposes `readiness.configuration` alongside independent `readiness.extractor`. Exit 0 means the applicable configuration checks passed; 1 means a required configuration or invocation failure. `--require-driving` is removed. Native UI coverage remains in driving reports/docs. Explicitly configured optional paths must be available; unset paths are omitted. Malformed config is reported without echoing its contents. The managed decision probe is opt-in with `--model`; default doctor never starts a model. Init and checkout-install results also use version-2 envelopes without the old native validation field; stored configuration/cache schemas are unchanged.

To update, inspect/pin the new checkout and Node/dependencies, install into a new owned prefix and rerun doctor/conformance. Preserve old receipts until accepted artifacts have been revalidated. For removal, inspect `installation.json` to confirm ownership, then remove that prefix's known `bin/traverse`, config/metadata, logs, npm config/cache and now-empty owned directories. Remove the whole prefix only if it contains no unrelated files. Do not remove a shared source checkout/dependency tree on behalf of another installation. For an npm archive installation, `npm uninstall --global traverse` removes that global CLI; review the selected npm prefix first. Project data under .wayfinder is separate and must be inspected before removal. There is no app SDK or agent-device extension to uninstall.

## Prepare, review, accept, refresh

The checked-in example is synthetic; its `6.0.0` version is an example input, not a claim about current CV dependencies. For real source, supply the exact installed/locked framework version, relevant routing configuration, explicit `app`/`@/` conventions, revision and a read-only JSON snapshot of relevant TypeScript/JavaScript source. Snapshot creation must exclude secrets and retain the precise included-file manifest. `sourceFingerprint` binds actual bytes; the revision alone does not account for local edits. No command here scans a sibling checkout implicitly.

Use a new directory for every request, author run, acceptance and refresh. From the Traverse package root:

```sh
mkdir -p .wayfinder/demo
node bin/extractor-pipeline.mjs prepare \
  --spec fixtures/extractor-pipeline/example-spec.json \
  --out .wayfinder/demo/request
node bin/extractor-pipeline.mjs reference \
  --request .wayfinder/demo/request/request.json \
  --out .wayfinder/demo/artifact.json
node bin/extractor-pipeline.mjs inspect \
  --artifact .wayfinder/demo/artifact.json
```

Read every artifact source file, its declared dependencies, and the pinned reference substrate. `inspect` prints the exact artifact hash. The reference command copies a small wrapper; **it is not agent generation**. After review, substitute the printed hash and your reviewer identity:

```sh
node bin/extractor-pipeline.mjs review \
  --artifact .wayfinder/demo/artifact.json \
  --hash EXACT_PRINTED_HASH --reviewer REVIEWER_NAME --trust-host \
  --out .wayfinder/demo/review.json
node bin/extractor-pipeline.mjs accept \
  --request .wayfinder/demo/request/request.json \
  --artifact .wayfinder/demo/artifact.json \
  --review .wayfinder/demo/review.json \
  --out .wayfinder/demo/accepted
node bin/extractor-pipeline.mjs refresh \
  --request .wayfinder/demo/request/request.json \
  --accepted .wayfinder/demo/accepted/accepted.json \
  --out .wayfinder/demo/refreshed
```

`accepted.json` is the content-addressed local cache entry; retain its adjacent process/conformance records. It pins source and script hashes, declared exact framework/config/contract, review, dependency/reference/validator hashes and environment. `graph.json` contains stable content. Process timing, signals, deadlines and identity live in separate receipts. Candidate execution and pipeline-owned reference/validation each have a 5-second default deadline (`--timeout` and `--validation-timeout`, each 1–30000 ms); reference parsing/normalization run in a supervised worker too. `refresh.json` explicitly records `authorCalls: 0`. A source-only change uses a newly prepared request and the same accepted artifact. Framework/config/schema/profile changes require renewed acceptance; unsupported profiles fail. Runtime, dependency, reference or validator changes invalidate cached acceptance. Artifact changes require a new exact-hash review. The high-level `graph watch` performs deterministic refreshes; no automatic reauthoring exists.

## Configured author command

`author --request REQUEST.json --config CONFIG.json --out NEW_DIR` runs one explicitly configured command, at most three attempts and 120 seconds per attempt. The request includes the pipeline-owned validator definition/hash, a complete reference artifact template and the explicit stdin/stdout/reference-import protocol. It sends `{request, execution, previousDiagnostic}` on stdin and requires only artifact JSON on stdout. The artifact declares `schema`, `compatibility`, `entrypoint`, bundled `.mjs` files, dependencies, coverage and unsupported cases. Use `reference`/`inspect` to see the exact supported format. The command's adapter must select the specified provider/model/effort explicitly and retain provider receipts. No sticky defaults are selected by this pipeline.

Example config structure (paths must be real absolute paths chosen by the operator):

```json
{
  "command": "/absolute/path/to/reviewed-author-adapter",
  "args": [],
  "identity": {"kind": "agent", "provider": "codex", "model": "gpt-6-astra", "effort": "high"},
  "timeoutMs": 120000,
  "maxAttempts": 1
}
```

This is a protocol example, **not an installed author adapter**. No real provider adapter was configured or invoked in this work. Identity fields are declarations, not attestation; saved command/stdout and provider receipts must prove an actual model run before claiming generation. Default tests run `fixtures/extractor-pipeline/fake-author.mjs` through Node with identity `fake/offline/reference-copy/none`. It merely returns the reference wrapper. Malformed-output and command-failure attempts retain diagnostics. Repairs after execution/conformance failure are manual, bounded new author runs and require new review; there is no autonomous validation-repair loop.

The author receives source as JSON data, not a writable path to a CV checkout. This protocol is a read-only source handoff, **not OS isolation**. Both the configured author command and reviewed extractor have host authority. The cache, reduced environment and subprocess working directory do not stop malicious filesystem/network access. Do not mark unknown code trusted just to pass tests. Run untrusted authors/candidates in a separately provisioned sandbox or container before importing reviewed bytes; building one is outside v1. The review record is a local trust acknowledgement, not a cryptographic signature or adversarial cache protection.

## Future CV / agent-device pilot

A small, separately authorized pilot needs these missing integrations:

1. **Identity binding.** Record source revision plus dirty-file fingerprint, accepted inventory hash, installed app build ID, effective backend/config, device identity, process session and JS runtime generation separately. An inventory fingerprint is not proof that an installed build matches it. Metro is optional. Rebind after reload/restart; refuse stale identity. Native host health must not depend on functioning app JS; native UI operations still need the main thread.
2. **Native observation/action projection.** Implement and independently test a projection from actual agent-device native snapshots to current visible/enabled controls, with layer/occlusion handling and stale-ref rejection. Do not reuse the DOM projector as if its semantics were native. Bind each offered control to source evidence only when unambiguous; preserve unknown edges/guards. Establish business effects and state through observations/contracts rather than inferred navigation alone.
3. **Owned session.** Reserve one disposable device and a unique session. Check capacity; never stop someone else's device/process. Use the installed CLI's documented `open`, `snapshot`, `fill`/`click`, `close` with explicit device/UDID/serial and `--session`. Re-snapshot after meaningful state changes. Do not use direct store mutation as action evidence.
4. **Decision loop and fallback.** On each step supply the goal, fresh current controls and bounded source graph facts. Only current offered IDs may be chosen. The existing browser candidate uses tev1 margin 0.819, confidence floor 0, estimated 1,500-input-token cap and single-option none fallback; failed/abstained local decisions escalate to explicit Sol 6.1/medium. Those are browser fixture settings, not native safety calibration. Missing candidates or ambiguous effects stop/escalate; the frontier cannot manufacture unavailable actions.
5. **Pilot acceptance.** Use synthetic users and an owned mock backend: navigate to one account route, edit a value, dismiss the keyboard, Save, reopen and verify the committed value; edit again, Cancel, reopen and verify preservation. Include one ambiguous/guarded route requiring escalation. Record starting state, ordered user actions, exact observations, preserved values, attempt/deadline failures and receipts. Separate dispatch acknowledgement from effect confirmation. Keep unsuccessful attempts in outcomes. No live CV/backend credential use is authorized here.
6. **Cleanup/update/removal.** Close only the owned agent-device session; stop only owned runtime/mock process groups and verify they exited; delete only disposable devices explicitly created for that pilot. Keep receipts, hashes and failed attempts. For pipeline removal, delete only caller-owned request/cache/run directories and this local checkout when no longer needed. There is no app package, global plugin or shared-service configuration to uninstall. Update pins deliberately and rerun conformance/review before accepting incompatible artifacts.

No real CV source/build identity, native projection, provider-generation receipt, UI effect contract or pilot result is delivered by this work. The source pipeline is a preparation layer for that future integration.

## Runnable installation sample

The source checkout includes `examples/expo` (not bundled in the CLI archive): a small Expo Router app with synthetic session-only Save/Cancel state. Install the archive once, then run `traverse init` in that directory. The shared static snapshot reader feeds actual source bytes and locked routing identity into reference/review/accept; the sample wrapper additionally checks its fixed example routes. No nested Git root, native driving or real-CV installation is implied.

## Promotion and existing acceptance

The package paths and dependency/source pins differ from the lab prototype. Preserve old installations and evidence; do not edit their metadata to repoint them. Install this package into a new prefix and prepare/review/accept afresh. Prototype acceptance is incompatible with this environment and refresh refuses it. There is no automatic acceptance migration or runtime driver. Only project configuration has an explicit `init --migrate` path. Research references above describe lab-owned historical work, not files required in this package.

The managed tag selects the explicit Q8_0 GGUF variant. The generic `tev1:4b` alias can select a different runner/format by platform; setup pins the exact variant and manifest rather than assuming those artifacts are interchangeable.

For the pinned runtime, integrity checks use the canonical manifest blob and its native `manifests-v2` name binding. A model reference may resolve only to the expected hash inside the owned blob store. Legacy downgrade anchors are not used as model identity.

## Project driving preferences

After init, use `traverse init` for the arrow-key wizard. It saves portable `.wayfinder/settings.json`; edit that file or rerun the command to update provider/model/effort, default mode or limits. See the [project setup guide](project-setup.md) for scripting and run override precedence. Actual app targets and recording are selected on every run. Plain `traverse setup` still manages machine-model assets.
