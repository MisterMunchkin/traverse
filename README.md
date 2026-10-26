# Traverse

Navigation context and local decision-making for agents that drive user interfaces. Traverse builds reviewed source graphs, offers a small local model for routine choices, and keeps frontier decisions and observable action results explicit.

**Status:** MIT-licensed prototype, preparing for its first public release. Browser-fixture experiments show promising reductions in driving time and frontier usage. The packaged native runner has offline contract coverage; live native/CV driving validation remains pending.

The package is `@mistermunchkin/traverse`; the executable is `traverse`. Previously called Wayfinder, it keeps `.wayfinder/` project state, `wayfinder-*` serialized schemas/ownership markers and `~/.cache/wayfinder` compatible. Existing projects keep their settings and model assets. `traverse init --agents shared` migrates intact old guidance to `.agents/skills/traverse/SKILL.md`. No global Wayfinder command is removed automatically.

Traverse prepares and validates reviewed Expo navigation extractors, then reuses accepted scripts without an LLM. The graph is a `cv-navigation/1` partial static source inventory. The package also includes an internal agent-device runner and bounded driving loop. See the [driving guide](docs/driving.md) for supported actions and validation coverage.

## Results and findings

The strongest completed comparison used **the same Sol 6.1 model at medium effort**, with and without tev1, on a source-backed browser fixture. Twelve new navigation pairs, two arms and two counterbalanced repeats produced **48 retained attempts** on 21 October 2026.

| Measurement | Sol alone | Sol + tev1 |
| --- | ---: | ---: |
| Verified completions / scheduled attempts | 23/24 | 24/24 |
| Driving time on the 23 common completions | 567.64 s | 318.43 s |
| Frontier requests, all attempts | 84 | 10 |
| Reported frontier input tokens, all attempts | 1,206,982 | 143,528 |

That is **43.9% less matched driving time** and **88.1% fewer frontier input tokens**. Driving time excludes browser startup and preparation; the token totals include every attempt. Subscription dollar charges, local hardware and energy costs were not measured. Large subscription context contributed to the token reduction.

The control's single failure was a browser-startup timeout before any model call. It remains a failed outcome; it does not show that tev1 improved reliability. No unsafe fixture effects were observed. These were short, known-graph workflows, not a general benchmark or validation of the current packaged native driver.

Earlier results and failures shaped the design:

- **Shared context helped:** one shared graph per decision request completed 40/48 synthetic goals versus 25/48 when overlapping graphs were repeated beside each option. The graph is resent with each observation; it is not conversation memory.
- **Savings depended on the task:** the earlier Opus pilot series verified 6/6 in both tree arms, with about 45% lower frontier API-equivalent cost for assistance. The screenshot reference verified 2/6. There were only two fixture goals, and these cost estimates were not subscription charges.
- **Assistance can lose:** an earlier browser pilot completed 11/12 assisted versus 12/12 control. Local inference followed by escalation adds work when the small model cannot decide.
- **Confidence is not safety:** a high choice margin can still select an action that violates the goal. Source graphs, host checks and verification serve different purposes; none makes unknown effects safe.
- **More structure was not automatically better:** text-encoded 3D coordinates added tokens without improving completion over the flat graph. A later specialized guard rejected every navigation-only case before model selection, exposing a host-contract portability failure.

See [research methods, negative results and limitations](docs/research.md) and the [portable aggregate results](docs/research/results.json). These historical lab studies motivated Traverse; their scores are not release-quality or native-app guarantees. Raw recordings and request logs are not bundled with this package.

## Install once, initialise each project

Traverse is not yet published to a registry; the package retains a publication guard while release preparation is in progress. A new machine needs Node and the package source or a provided archive; it does not need the surrounding experiment repository. To build and install an archive, run from this package's source directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm pack
npm install --global ./mistermunchkin-traverse-0.12.0.tgz
```

This is an explicit global npm installation. The development checks use a disposable prefix instead; they do not change your global tools or shell profile. There is no public registry package or curl installer advertised here. Node >=22.11 is required.

Set up the optional local decision model once per machine (macOS arm64):

```sh
traverse setup --dry-run
traverse setup
```

Setup downloads pinned Ollama 0.40.8 and `tev1:4b-q8_0` into `~/.cache/wayfinder`, verifies archive/manifest/blob hashes, and checks a real choice response before reporting ready. Reruns reuse verified files and recheck the decision endpoint. The model download is several GB. It never attaches to an existing Ollama daemon; setup and the explicit model smoke check use a private temporary server and stop its owned process group. No npm lifecycle hook downloads models. `--cache-dir` selects another owned cache; `--runtime-archive` and `--models-dir` import explicitly selected assets with the same checksum verification. `setup --check` is read-only. Unsupported platforms fail before writing.

Alternatively, install the CLI as a repository **dev dependency**. Put the built tarball in that repository at `vendor/mistermunchkin-traverse-0.12.0.tgz`, then run:

```sh
npm install --save-dev ./vendor/mistermunchkin-traverse-0.12.0.tgz
npm exec -- traverse init
```

Commit the tarball, `package.json` and `package-lock.json` so other machines install the same version with `npm ci`. Use `npm exec -- traverse ...` (or an npm script) for the repo-local executable. This does not install a global command or download a model. Machine setup, when needed, is `npm exec -- traverse setup`; the verified model/runtime cache remains shared per user under `~/.cache/wayfinder`, outside the repository. No Traverse package has been published to a registry.

With a global CLI, run this inside a supported Expo project:

```sh
traverse init
traverse graph check
traverse graph watch
```

Interactive `init` creates the graph and walks through project preferences in one command. The wizard uses arrow keys, editable inputs, Back and a final save confirmation; cancelling before Save leaves project files unchanged. It selects Codex/Claude, model/effort and driving defaults in `.wayfinder/settings.json`. The optional **Install shared skill / Skip** step keeps one Traverse skill in `.agents/skills/traverse/SKILL.md` and points to it from `AGENTS.md`; fresh projects default to Skip. See [agent guidance](docs/project-setup.md#optional-agent-guidance) for migration and Claude discovery requirements. This is separate from the frontier provider. Commit the guidance with the repo. Existing instructions are preserved and custom skills are not overwritten. Edit settings or rerun `traverse init` to change defaults. See the [project setup guide](docs/project-setup.md) for guidance paths, scripting, per-run overrides and provider prerequisites. Actual app instances and recording remain per-run choices.

After init, run `traverse doctor --model` if you set up the local model; it verifies both project readiness and a real model response.

`init --json` or piped/noninteractive init skips the preferences wizard unless preference flags or `--agents shared|skip` are supplied; a missing adapter returns a review result or asks for provider settings; `--no-interactive` explicitly keeps graph-only setup. First scripted preferences require `--provider`, `--model` and `--effort`. `setup --project DIRECTORY` remains a compatibility route for editing defaults on initialized projects.

Init reuses a compatible bundled or accepted deterministic extractor. A supported profile without an adapter uses the configured subscription CLI and tool-owned prompt, then requires exact-code review and independent validation before it publishes the graph. See [managed adapters](docs/adapters.md). Refresh/watch need no author. Source edits/deletions make `graph check` fail until `graph refresh` runs; watch debounces changes and refreshes automatically. Failed extraction preserves the last valid graph, while check/doctor report it stale. Ctrl-C stops watch and its owned extraction children. `--json` returns one result except watch, which streams `wayfinder-graph-watch-event/1` NDJSON events.

Commit `.wayfinder/settings.json` after project setup, `.wayfinder/project.json`, `.wayfinder/extractor/artifact.json` and `.wayfinder/graph.json`. Init appends an allowlist block to the selected project's `.gitignore`, preserving its existing text, and creates `.wayfinder/.gitignore` to exclude local execution approvals, snapshots, logs, caches and older installs. It never edits an ancestor ignore file. The graph is one portable `wayfinder-repository-graph/1` document: an unchanged `cv-navigation/1` inventory plus source/configuration/extractor/generator fingerprints. Copies work at another path; custom extractor execution approvals stay local.

Compatible init reruns preserve configuration bytes. Existing schema-1 projects require `traverse init --migrate`; original configuration bytes are backed up under ignored `.wayfinder/local/project-v1.json`. Existing install folders are preserved. Init refuses malformed, conflicting or symlink state; `--check` and `--dry-run` make no changes. Use `--project /absolute/project` from another directory; commands never search parents or siblings.

The legacy static SDK57 profile stays compatible. The new Expo57 profile supports static routing facts in JS/TS app config, `app/` or `src/app/` and project-relative wildcard aliases. Config is inspected without execution. Unknown routing facts and frameworks without independent conformance stay unready; see [profile limits](docs/adapters.md#first-supported-profiles). The bounded source inventory is not a complete runtime graph.

Doctor checks configuration health: runtime/parser, installation integrity, project setup, current graph and configured integration paths. `doctor --json` uses `wayfinder-doctor/2` with `readiness.configuration` and separate `readiness.extractor`. Exit 0 means all applicable configuration checks passed; 1 means a configuration or invocation failure. Unconfigured optional tools/models produce no warnings; explicitly configured missing tools, selected caches and incomplete attempted model setup fail. Doctor also validates saved driving settings and selected provider executable availability without launching the CLI. Default doctor never starts a model; `--model` explicitly checks a real decision through a private owned runtime. Native UI test history belongs in run results and validation reports. Human diagnostics go to stderr; JSON is one undecorated result on stdout. Help/version work outside a project.

Doctor, help and version use teal headings and status icons in a terminal. Nonempty `NO_COLOR` disables colour while retaining the icons; `TERM=dumb`, CI and redirected output use plain text. Redirected `--version` remains a bare version number. Doctor follows stderr's terminal status; help/version follow stdout's. JSON output has no decoration.

Snapshot creates immutable `spec.json` and `provenance.json` in a new output directory. Continue with `traverse extractor prepare --spec SPEC.json --out NEW_REQUEST_DIRECTORY`, then the existing inspect → exact-hash host-trust review → acceptance → refresh workflow. Init can generate a missing supported adapter through Codex/Claude, or review an explicitly supplied `--adapter FILE --trust-adapter SHA256`. Changed or unknown code is never automatically approved. The advanced exact-hash review/acceptance flow and `graph refresh --accepted /absolute/accepted.json` remain available. See the [adoption guide](docs/adoption.md).

The source checkout includes the Expo example at `examples/expo`; app dependencies and the example are not bundled into the CLI archive. Its README covers manual UI testing separately from extraction.

## Driving checkpoint

See [driving commands and task/frontier contracts](docs/driving.md). All driving commands below are explicit live operations when run against a real agent-device installation. The standard test suite uses fixture executables and launches no UI or model services.

```sh
traverse device capabilities --json
traverse session --help
traverse drive --help
```

`observe` captures current UI; Traverse adds graph context separately. `act` checks the observation, resolves fresh references, dispatches once and captures the result. Source navigation never proves a business effect. Session observations and cleanup remain available after source edits; starting a new graph-assisted session/run requires a current graph.

## Advanced checkout installation

From this package directory:

```sh
./install.sh
```

This records a checkout-linked launcher under `~/.local/share/traverse` and prints its full executable next command. It creates missing directories and installs the parser from `npm-shrinkwrap.json` if needed. It does not edit PATH or shell profiles. Optional `--prefix /absolute/owned/path` selects an isolated location, and `--node /absolute/path/to/node` chooses Node; neither is needed for ordinary setup. `--verbose` shows source/Node detail. `--json`, `--check` and `--dry-run` preserve their existing contracts.

A checkout launcher pins its source and Node; source/runtime changes require inspection and a fresh prefix. Its default `doctor` preserves installation-only checks; add `--project .` for project checks. An npm-installed command checks its package runtime and requires project initialization for doctor. Both execute the same extractor pipeline in the same process, with its existing budgets and trust boundary. No old acceptance or installation is silently repinned.

## Development

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm pack
```

The standard npm shrinkwrap is the sole product lock and is included in the archive. Runtime code has no lab/Git/worktree dependency. AST/parser, choice transport and process supervision have one implementation here; lab consumers import the canonical primitives. Driving requires an installed agent-device; local-first additionally requires the managed model. Other routing frameworks require independent host-owned conformance before enablement. No public runner plugin API or public release is included.

The managed tag selects the explicit Q8_0 GGUF variant. The generic `tev1:4b` alias can select a different runner/format by platform; setup pins the exact variant and manifest rather than assuming those artifacts are interchangeable.

## Automation compatibility in 0.5

Doctor, init and checkout-install result envelopes use `wayfinder-doctor/2`, `wayfinder-init/2` and `wayfinder-install-result/2`. They omit the old unconditional `nativeDriving` field. Doctor adds `readiness.configuration`; `readiness.extractor` continues to describe extraction prerequisites independently. `--require-driving` is removed and rejected as an invocation error. Driving results still retain real failures, uncertain effects and recording/playback verification fields.

Persisted project configuration, source graphs, installation ownership and managed model-cache schemas are unchanged; no data migration or model download is required by this release. Existing checkout-linked installs still require their normal explicit source/prefix update. Installing a new global archive requires a separate explicit update.

## License

Traverse's original code and documentation are available under the [MIT License](LICENSE), copyright 2026 Traverse contributors. Dependencies, the Expo-derived example, separately downloaded Ollama/model assets and external tools retain their own licenses and terms; see [third-party components](docs/third-party.md). The package license does not relicense those assets or the surrounding experiment repository.
