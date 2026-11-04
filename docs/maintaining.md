# Maintaining Traverse

This is the starting point for maintaining Traverse from this repository alone. No experiment checkout, private machine paths, global agent skills or conversation history is required.

## Start from a fresh checkout

Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for the exact Node version, both locked installs and `npm run check`. That headless gate uses synthetic fixtures and verifies an actual installed archive. It needs no model weights, provider account, agent-device installation or running application.

Use the [README](../README.md) to install the CLI and the [Expo example](../examples/expo/README.md) to try it in an app. The Traverse source root is not a supported Expo app: initialize inside the example or another supported app directory.

Agents should read [AGENTS.md](../AGENTS.md) and the repo-local [traverse-maintainer skill](../.agents/skills/traverse-maintainer/SKILL.md). The skill routes to these maintained docs; no global skill installation is needed. The separate [consumer template](../src/skills/traverse.md) is what init can install into an app.

## Source map

| Area | Starting points | Responsibility |
| --- | --- | --- |
| Commands/output | [bin/](../bin/), [presentation](../src/presentation.mjs), [wizard](../src/setup-wizard.mjs) | Dispatch, flags, help, human/JSON output and guided setup. |
| Project inputs | [project](../src/project.mjs), [extended Expo profile](../src/project-profile.mjs), [Next profile](../src/project-next.mjs) | Bounded static config, installed/locked versions and source snapshots. |
| Extraction | [navigation](../src/source/navigation.mjs), [AST](../src/source/ast.mjs), [Next parsing](../src/source/next.mjs) | One implementation of partial TypeScript source navigation facts. |
| Reviewed extractors | [pipeline](../src/extractor-pipeline/pipeline.mjs), [contract](../src/extractor-pipeline/contract.mjs), [profiles](../src/extractor-pipeline/profiles.mjs), [worker](../src/extractor-pipeline/validate-worker.mjs) | Hash review, independent conformance/current-source validation, acceptance and refresh. |
| Authoring | [adapter init](../src/adapter-init.mjs) | Tool-owned prompts, bounded drafts and explicit trust before publication. |
| Repository graph | [graph](../src/graph.mjs) | Fingerprint bindings, atomic publication, staleness and watchers. |
| Managed model | [setup](../src/model-setup.mjs), [pins](../src/model-pins.json), [runtime](../src/runtime/ollama.mjs) | Official-asset integrity, per-user cache, choice readiness and owned runtime. |
| Frontier | [settings](../src/settings.mjs), [clients](../src/frontier/provider.mjs), [catalogs](../src/frontier/models.mjs), [Codex worker](../src/frontier/codex-worker.mjs) | Project preferences, subscription CLI discovery and structured requests. |
| Driving | [sessions](../src/driving/sessions.mjs), [agent-device](../src/driving/agent-device.mjs), [loop](../src/driving/loop.mjs), [policy](../src/driving/policy.mjs) | Observations/actions, verification, decisions, budgets and cleanup. |
| Infrastructure | [process](../src/runtime/process.mjs), [installation](../src/installation.mjs), [state](../src/state.mjs) | Bounded child ownership, installation health and guarded writes. |
| Agent guidance | [integration](../src/agent-integration.mjs), [consumer template](../src/skills/traverse.md) | Optional app skill and checksum-protected instruction updates. |
| Verification | [tests](../test/), [scripts](../scripts/), [CI](../.github/workflows/ci.yml), [example](../examples/expo/) | Serial regressions, fixtures, distribution isolation and sample checks. |

Only exports declared in [package.json](../package.json) are package entrypoints. Other modules, including the runner contract, are internal rather than a public adapter SDK.

## Decisions and contracts

**Source graphs and live UI answer different questions.** A graph records declared routes, guards, source provenance and uncertainty. It cannot prove the current screen, installed build or business effect. Driving observes current controls and verifies explicit expectations after real actions. Models may choose only offered controls; a graph edge does not authorize an invisible target.

**Generated code has host authority.** An author cannot select its validator or approve its own artifact. Exact bytes require review, then independent conformance/current-source validation. Only the exact bundled reference has the narrow automatic trust path. Reduced environments and bounded subprocesses are not an OS sandbox for malicious code. See [adapter review](adapters.md).

**Refresh is deterministic.** Refresh/watch reuse accepted code with zero author calls. Graph bindings cover source, configuration, extractor and generator/environment identity. Source changes make graphs stale; parser, validator, runtime or compatibility changes can invalidate acceptance. Preserve the last valid graph on failure. Never update recorded hashes merely to make a check pass.

**Format versions are independent of CLI versions.** Inventories use `schema: "traverse-navigation"` and `schemaVersion: 1`. `.wayfinder` paths and `wayfinder-*` envelopes remain compatibility identifiers. Branding is not a schema migration. [Navigation upgrades](adoption.md#navigation-format-upgrades) preserve old state and require fresh trust; old approvals are never silently rewritten.

**Doctor checks configuration.** Default doctor performs health/extraction checks without inference. An unconfigured optional model is omitted; configured incomplete state fails. `doctor --model` explicitly probes the managed model. Native coverage belongs in [driving validation](driving.md#validation-coverage), not in a pending doctor gate.

**Own what you start.** Reuse the bounded process supervisor for cancellation and child-group cleanup. Do not adopt/stop shared model daemons, devices or services. Preserve rerun, read-only and cancellation behavior. A timeout after UI dispatch leaves its effect uncertain and must not automatically repeat the mutation.

**Keep failures and unknowns visible.** Verified tasks require explicit observations and successful cleanup. Failed attempts/timeouts count. Missing usage/cost stays unknown; saved video bytes do not establish playback. [Driving](driving.md) defines the result and exit semantics.

## Current support and limits

Extraction supports the two host-owned Expo 57/Router 57 [profiles](adapters.md#first-supported-profiles) and the bounded [Next16.0/React19.2 App Router profile](adapters.md#next-app-router-first-slice). The original uses a bundled reference; the extended static profile can require generated, reviewed code. Another framework needs host-owned compatibility rules, independent validation and fixtures first. App config is inspected statically, never executed.

The driving policy receives the shared graph, fresh UI, goal/inputs and the last eight actions. Local choice uses margin 0.819, confidence floor 0, an estimated 1,500-token ceiling and 23-control limit with frontier escalation. These are fixture-derived defaults, not native safety calibration. Change them through explicit experiments and outcome accounting.

The full contributor gate covers macOS arm64 with Node 22.21.1 pinned in `.nvmrc`. Managed model setup is also macOS arm64. Official asset acquisition and constrained-choice inference have been exercised; the packaged local-first smoke did not complete a UI task. Runner/provider contracts are fixture-tested. Packaged live browser/native tasks, real subscription inference through these clients, durable backend effects and video playback need observed validation. Other OS/runtime coverage is not established.

[Research](research.md) and [aggregate results](research/results.json) retain the measured fixture findings and negative results. A portable experiment runner and raw recordings are not included; the aggregates are not a replayable benchmark or native proof.

## Updating dependencies, models and compatibility

For parser/dependency changes, update the exact manifest pin and npm shrinkwrap together using npm. Keep the example's separate lock consistent when changing it. Review dependency/license changes, run affected semantic fixtures and the full gate, and expect environment changes to require renewed local extractor acceptance. Do not edit old approvals.

For a runtime/model update, review `src/model-pins.json` as a unit: version, official archive URL/checksum and exact model tag/manifest digest. Verify actual official assets, blob integrity, import/rerun, partial failures and constrained-choice inference in an explicitly authorized owned cache. An alias or copied ready receipt is insufficient. Add platform fixtures and bounded cleanup evidence before claiming another platform. Automated checks must not overwrite default caches.

For a routing profile/navigation version, add host-owned compatibility/validation and independent miniature expectations before accepting generated code. Cover guards, aliases, unresolved targets, provenance and determinism. Define old-state refusal/migration and preserve receipts. Run affected adapter, graph lifecycle and distribution checks; compatible-looking JSON alone does not preserve trust.

For provider/agent-device updates, retain observed executable/protocol identity and fixture coverage for changed shapes, unavailable capabilities, deadlines and cancellation. Check the installed tools' own runtime prerequisites for live tests; Traverse's Node floor does not certify runner compatibility. Catalog discovery is not subscription inference attestation.

## Verification and diagnosis

Run the final integrated `npm run check` from [CONTRIBUTING.md](../CONTRIBUTING.md). Save input hashes, report path and command receipts. Finish checks before resuming edits/dependency changes. Inspect the actual diff/results and use one independent reviewer for a cohesive change. Preserve behavior assertions and bug-fix RED/GREEN evidence.

For an app configuration problem, start with `traverse doctor --json` and `traverse graph check --json`. Read named failed receipts before retrying. Refresh is not approval of changed code; init can review a pinned adapter on a new machine. Preserve failed setup/session evidence, especially after uncertain UI actions.

`.checks/`, app `.wayfinder/local/` and model-cache `runs/` hold private diagnostics, not prerequisites for fresh contributors. Share curated synthetic evidence with identity and limitations. Do not commit raw UI/provider logs, credentials, weights or recordings. No IDE or multi-agent harness is required.

## Packaging and releases

Current identity is `@mistermunchkin/traverse`, version 0.12.0, `private: true`: source/local archives are available, npm publication has not occurred. `npm run check:package` packs and installs a real temporary dev dependency, compares installed bytes with source and denies source/network access during CLI calls.

After the integrated gate, prepare a local distribution:

```sh
npm pack --ignore-scripts
```

Inspect archive contents, notices and intended version. The manifest's `files` allowlist defines the shipped surface; the Expo app, contributor tests and repo-only maintainer skill are not runtime prerequisites. Keep version/shrinkwrap metadata consistent for releases. Review [third-party terms](third-party.md) and prepare notes describing behavior, validation and limits.

Approve the exact commit, version, repository visibility and npm target before pushing, tagging, changing `private`, publishing or updating a global installation. Keep `private: true` until an explicit release change. No workflow currently publishes a package. Installation/removal uses the actual scoped package name and selected npm prefix; see [installation scopes](adoption.md#installation-scopes).
