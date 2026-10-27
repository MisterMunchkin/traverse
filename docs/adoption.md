# Installation and source graphs

Traverse installs alongside an app; it embeds no SDK. It extracts reviewed static navigation graphs, maintains them as source changes, and supplies graph context to the separate UI-driving loop. A source graph cannot prove current UI, build identity or a business effect.

For contributor setup, use [CONTRIBUTING.md](../CONTRIBUTING.md). For architecture, contracts and updates, use the [maintainer handbook](maintaining.md). These instructions require only this repository and explicitly selected tools.

## Installation scopes

The npm package is not published yet. Build an archive from this checkout using the [README commands](../README.md#install). It installs the scoped package `@mistermunchkin/traverse` and provides the `traverse` executable. The installed package works independently of the source checkout.

- A global npm installation makes the executable available in that npm prefix. It does not initialize every project or install a model.
- A repository dev dependency provides the same CLI through `npm exec --offline -- traverse ...`. Install a real local archive; do not fetch a nonexistent registry release.
- `traverse init` configures the selected app repository and can install its shared agent skill. `traverse setup` separately acquires the per-user model cache.

Node 22.11+ is the installed CLI's minimum. The contributor gate and Expo example have the higher requirements documented in CONTRIBUTING. Graph extraction needs TypeScript 6.0.3, pinned and installed by the package. It needs no provider login, model, device or global agent skill for the bundled profile.

Codex/Claude subscription CLIs and agent-device are independently installed optional tools. Use a provider only when authoring or driving needs it; select agent-device from PATH or with `--agent-device /absolute/executable` for live driving. Check each installed tool's own platform/runtime prerequisites. Existing machine launchers, previous experiment environments and shared model daemons are not assumed.

To update an npm installation, prepare and verify the new archive, then deliberately install it into the selected prefix or project. Inspect the prefix before a global change. To remove that CLI, use `npm uninstall --global @mistermunchkin/traverse`, or `npm uninstall --save-dev @mistermunchkin/traverse` inside its consuming project. Project `.wayfinder/` data and the model cache are separate; inspect ownership and preserve needed settings/receipts before removing either.

## Initialize and maintain a project

Inside a supported Expo app with its locked dependencies installed:

```sh
traverse init
traverse graph check
traverse graph watch
```

The original `expo-source-inventory/1` profile covers the static SDK57/root-app example and uses a bundled extractor. `expo-source-inventory/2` adds the supported extended static Expo57 inputs, including `src/app` and static app config. See [supported profiles](adapters.md#first-supported-profiles) for exact conditions, exclusions and the generated-adapter path. Other routers require host-owned compatibility rules, validation and fixtures before an adapter can be accepted. No project configuration is executed to infer compatibility.

Init creates portable `.wayfinder/project.json`, `.wayfinder/extractor/artifact.json` and `.wayfinder/graph.json`; the wizard can save `.wayfinder/settings.json` and shared agent guidance. Commit those portable outputs. Local execution trust, failure receipts, sessions and recordings stay ignored. Compatible reruns preserve config bytes. `--project DIRECTORY` selects an explicit app; it does not search sibling checkouts. Read-only `--check` and `--dry-run` do not generate or execute candidates or write staging state.

Init reuses compatible bundled or locally accepted code. If the supported profile needs an adapter, init owns the author prompt and uses the selected subscription CLI. Review the exact candidate bytes/hash before authorizing host execution. Independent conformance and current-source validation must pass before project state is published. On a new machine, a pinned custom extractor needs local trust again; init can review it without generating it again. See [adapter authoring and review](adapters.md).

`graph refresh` and `graph watch` make zero author calls. The stable `wayfinder-repository-graph/1` envelope binds source/configuration/extractor/generator identity to the inventory. `graph check` recomputes freshness without executing unknown code. Watch serializes debounced refreshes, preserves the last valid graph on failure and closes owned watchers/processes on interruption. JSON watch emits NDJSON ready/stale/stopped events; other commands emit one result.

Use `traverse snapshot --out .wayfinder/snapshots/first` for a bounded source snapshot with routing/package hashes. Its fingerprint is not a Git/build/runtime identity. Snapshot output must be outside reserved source roots. The [Expo example](../examples/expo/README.md) provides a synthetic project and manual Save/Cancel acceptance sequence.

## Navigation format upgrades

Inventory identity is `"schema": "traverse-navigation", "schemaVersion": 1`, independent of the CLI version. Specs, configuration, artifacts, dependencies and approvals bind the complete contract. Partial coverage, guards, hidden registrations, source provenance and unresolved/dynamic/history targets remain explicit.

Projects using the former `cv-navigation/1` identity need fresh initialization. Do not hand-edit hashes or replace tags in graphs/artifacts/approvals. Init, including `--migrate`, refuses the former navigation identity before writes. `init --migrate` handles the older project-config placement/version; it is not a navigation-contract migration.

Preserve the **entire** `.wayfinder` directory at a new, unused path outside the repository and its source roots. Confirm that the destination does not exist before moving it:

```sh
mv .wayfinder ../wayfinder-before-navigation-v1
traverse init
traverse graph check
```

Keep the backup private because it may contain real UI/provider data. Re-select preferences and obtain fresh exact-code trust for custom extractors. Never copy old approvals into the new state. Missing/unsupported versions fail explicitly. Existing `.wayfinder` names and other `wayfinder-*` envelopes remain compatibility identifiers; they are not branding to replace manually.

## Managed model and configuration health

`traverse setup` downloads verified official Ollama and `tev1:4b-q8_0` assets into `~/.cache/wayfinder`, once per machine. Current support is macOS arm64; the download is several GB and weights are absent from the npm archive. [model-pins.json](../src/model-pins.json) owns the exact runtime archive checksum and model manifest digest. The Q8_0 variant is deliberate; a generic `tev1:4b` alias is not an interchangeable identity.

Setup verifies blobs and the pinned runtime's canonical manifest/`manifests-v2` binding, then validates an actual constrained-choice response before publishing readiness. It does not adopt or modify another model service/cache. `--cache-dir` selects an explicit owned cache; `--runtime-archive` and `--models-dir` import verified assets. Failed attempts preserve their stage, error and receipt directory under cache `runs/`. Conflicting published/partial caches and stale locks are refused; inspect/preserve them before selecting a fresh cache or planning a repair.

`setup --dry-run` previews without writes; `setup --check` checks installed pins without starting inference. Compatible reruns deeply verify and preserve metadata. Default doctor checks an existing/explicitly selected cache without inference, omits an unconfigured optional model, and fails configured incomplete state. `doctor --model` explicitly starts a bounded tiny choice probe and stops its private runtime. Graph commands need no model.

Doctor describes configuration health, not native test history. `wayfinder-doctor/2` reports `readiness.configuration` and `readiness.extractor`; exit 0 means applicable checks passed and exit 1 means a configuration/invocation failure. Optional configured paths must exist; unset paths are omitted. Malformed config is not echoed. Driving validation and coverage belong in [the driving guide](driving.md#validation-coverage), separately from installation health.

## Checkout-linked developer installation

The optional package-root `install.sh` creates a launcher tied to this exact source checkout. It does not copy the repository, edit PATH/profiles, install global tools or acquire a model. Keep the source directory and recorded Node available for that launcher.

```sh
./install.sh --prefix /absolute/owned/traverse --node /absolute/path/to/node --dry-run --json
./install.sh --prefix /absolute/owned/traverse --node /absolute/path/to/node
/absolute/owned/traverse/bin/traverse doctor --json
```

`--prefix` defaults to `~/.local/share/traverse`; `--node` defaults to Node on PATH. Setup creates owned `bin/traverse`, `config.json` and `installation.json` automatically. Compatible reruns preserve config bytes; unknown ownership, symlink escapes or changed pins are refused. Missing/incompatible parser dependencies trigger the package's locked npm install with lifecycle scripts disabled, an owned cache/config and bounded receipts under `PREFIX/logs/`. Optional `--npm` selects an explicit npm executable, and `--timeout-ms` accepts 1..120000. `--check` and `--dry-run` invoke no npm and write no files; normal install may update only this checkout's parser dependencies and owned prefix.

Optional `--project /absolute/app` records an explicit read-only project; it does not initialize/extract that app. The small `wayfinder-config/1` config contains `project` and optional absolute `tools.agentDevice`, `ollama`, `frontier` and `models` paths. Doctor checks optional path availability without launching those tools; availability is not usable-version or inference attestation. It also checks installation pins and a bounded trusted extraction. Only the exact bundled reference has the automatic trust path.

After source/Node/dependency changes, inspect the new identity and choose a fresh owned prefix. Preserve old receipts until reviewed artifacts are revalidated. To remove a checkout-linked install, verify ownership in `installation.json`, preserve needed diagnostics, then remove its known launcher/config/metadata/log/cache files. Remove the whole prefix only if it contains no unrelated data; do not delete shared source dependencies. Npm installation has the separate removal commands above.

## Low-level extractor workflow

The lower-level `bin/extractor-pipeline.mjs` supports explicit prepare/reference/inspect/review/accept/refresh operations. Most app users should use init and graph commands. The fixture below is synthetic; its framework version is an input example, not additional compatibility support.

From this package root, choose fresh output directories:

```sh
mkdir -p .wayfinder/demo
node bin/extractor-pipeline.mjs prepare --spec fixtures/extractor-pipeline/example-spec.json --out .wayfinder/demo/request
node bin/extractor-pipeline.mjs reference --request .wayfinder/demo/request/request.json --out .wayfinder/demo/artifact.json
node bin/extractor-pipeline.mjs inspect --artifact .wayfinder/demo/artifact.json
```

Read every artifact file, declared dependency and pinned reference substrate. `reference` copies a deterministic wrapper; it is not agent generation. After inspecting those exact bytes, substitute the printed hash and your reviewer identity:

```sh
node bin/extractor-pipeline.mjs review --artifact .wayfinder/demo/artifact.json --hash EXACT_PRINTED_HASH --reviewer REVIEWER_NAME --trust-host --out .wayfinder/demo/review.json
node bin/extractor-pipeline.mjs accept --request .wayfinder/demo/request/request.json --artifact .wayfinder/demo/artifact.json --review .wayfinder/demo/review.json --out .wayfinder/demo/accepted
node bin/extractor-pipeline.mjs refresh --request .wayfinder/demo/request/request.json --accepted .wayfinder/demo/accepted/accepted.json --out .wayfinder/demo/refreshed
```

Retain acceptance and adjacent execution/conformance receipts. Acceptance binds artifact/review, source, compatibility, dependency/reference/validator and environment hashes. Candidate and independent validation workers have bounded deadlines; changed code/compatibility/runtime requires renewed validation and exact-code review as applicable. Refresh records `authorCalls: 0`.

Low-level `author` additionally accepts an explicitly configured executable that receives `{request, execution, previousDiagnostic}` on stdin and emits artifact JSON on stdout. The request includes a complete template and the host-owned validation definition. A custom command must retain actual provider/model/effort receipts: declared identity is not attestation. Consult `node bin/extractor-pipeline.mjs author --help` for the command interface; [managed init](adapters.md) already supplies the built-in provider path for supported profiles.

Authors/extractors have host authority. Source-as-JSON, reduced environments, working directories and deadlines are not isolation against malicious filesystem/network access. Review records acknowledge local trust, not a cryptographic signature. Untrusted code needs separately provisioned isolation before importing reviewed bytes. No automatic approval or universal-framework claim is implied.
