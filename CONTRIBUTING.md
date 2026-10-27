# Contributing to Traverse

Keep changes small, preserve explicit source/graph trust, and exercise the installed package. Use the [maintainer handbook](docs/maintaining.md) for the source map, architecture, pin updates and releases. Read the [CLI design guide](docs/contributing/cli-design.md) before changing commands or terminal output. Agents can enter through the checked-in [maintainer skill](.agents/skills/traverse-maintainer/SKILL.md); no global skills are required.

## Fresh checkout

Use macOS arm64 and Node **22.21.1** (`.nvmrc`) for the current full contributor gate. Node 22.13+ is required by the Expo example; the installed CLI's separate minimum remains 22.11. The model-setup tests use macOS arm64 fixtures, so this gate does not establish Linux, Windows or Intel support.

Clone this repository (GitHub access is required while it is private), select the Node version above, then install both lockfiles **sequentially**:

```sh
git clone https://github.com/MisterMunchkin/traverse.git
cd traverse
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix examples/expo --ignore-scripts --no-audit --no-fund
npm run check
```

The package tests read the example's actual installed Expo/Router manifests. Installing only the root dependency is insufficient. Setup needs npm registry access; checks start no real model, provider, browser, simulator or device. Some tests use owned loopback servers and fake executables.

## Checks

`npm run check` runs these stages, in order:

- Serial package tests (`npm test`).
- Expo example typecheck, lint and snapshot tests.
- Offline Expo web export; no browser is opened.
- Actual archive installation and CLI verification (`npm run check:package`).

Use `npm test` for an affected package change during development; run the full gate on the final integrated change. Avoid overlapping installs or checks. Generated example files remain ignored.

The package smoke installs the built tarball as a **dev dependency** in a disposable consumer, compares source/archive/installed file hashes, and verifies help/version, read-only preview, fresh init, rerun preservation, doctor, graph check/refresh and snapshot. During those CLI calls, the macOS sandbox denies source-checkout reads and network access. Removing one installed source module must make doctor fail; restoring it must restore readiness. This checks distribution and configuration, not inference or live driving. All npm config, HOME, cache and installs are temporary; no real global installation is changed.

Reports default to fresh ignored directories under `.checks/`. Each includes source hashes, environment and command receipts with exit/signal, deadlines, stdout/stderr and the final outcome. A failed check retains its diagnostics. Choose a fresh explicit path when needed:

```sh
npm run check -- --out .checks/my-change
npm run check:package -- --out .checks/package-only
```

Existing output paths are refused. `--help` is read-only. Temporary installation trees are removed on completion; the per-command receipts and archive/file hashes remain in the report. Review and retain needed reports before deleting your own `.checks/` directories. These are local diagnostics, not a publishable evidence bundle.

## CI

[CI](.github/workflows/ci.yml) uses the same two installs and full check on a macOS arm64 runner with `.nvmrc`. It runs on pull requests and pushes to `main`; failed runs retain check reports as a short-lived Actions artifact. Actions are pinned to immutable revisions and the workflow has read-only repository permission. It neither publishes a package nor runs live models/devices.

A workflow definition is not a passed hosted run. Check its actual status before reporting CI success. Broader OS/runtime coverage and live native driving need separately scoped validation.

## Changes and review

Preserve strict schemas, exact dependency pins, independent conformance checks, uncertainty and explicit review of executable adapters. Do not migrate approvals by editing hashes or silently accept changed code. Tests should assert user-visible behavior and meaningful failure cases; keep regression RED/GREEN evidence for bug fixes.

Keep the runtime self-contained. Contributor scripts and docs may use this checkout; installed commands may not depend on it, an IDE, personal paths or historical experiment archives. Do not commit local settings, caches, model weights, recordings or raw UI/provider logs. Synthetic fixtures are preferred for shareable examples.

Before proposing a change, run the gate, inspect the diff and reports, and describe the behavior changed, verification and remaining limits. Preserve relevant third-party notices. Publication, release and real global-install actions are separate maintainer decisions.
