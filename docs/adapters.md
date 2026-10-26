# Managed navigation adapters

`traverse init` owns the author prompt and response contract. A compatible bundled or locally accepted adapter is reused. When a supported routing profile has no adapter, init uses the selected Codex or Claude subscription CLI, model and effort from the wizard or `.wayfinder/settings.json`. It never asks you to write a prompt or an author-config file.

## First supported profiles

Both profiles produce `cv-navigation/1`, a partial static source inventory with source locations, guards and unresolved targets. Neither proves runtime visibility or business effects.

- `expo-source-inventory/1` preserves the original static SDK57 example profile and its bundled extractor.
- `expo-source-inventory/2` supports installed/declared/npm-locked Expo57 and Expo Router57, `expo-router/entry`, `app/` or `src/app/`, project-relative wildcard aliases and static Router facts inside `app.json`, `app.config.js`, `.ts`, `.mjs` or `.cjs`. Metro/Babel config files are fingerprinted without execution. Non-source assets are excluded from source inventory. Unknown or dynamic routing facts are rejected with a specific reason.

JavaScript/TypeScript app config must export a static object (`module.exports` or `export default`). Environment expressions outside routing facts are not evaluated or sent to the author. Function-exported config, unresolved routing spreads, conditional Router declarations, dynamic Router options, custom route roots, other framework/version combinations and other package managers need additional independent profile support. Conditional plugin-list branches with statically known non-Router identities are inspected without selecting a branch; a conditional Router or unknown spread is rejected. The tool never executes configuration to guess its result.

This milestone adds the managed authoring path and a host-owned profile registry, not a universal framework adapter. TanStack Router and other routers cannot report ready until a host-owned profile supplies compatibility rules, independent semantic validation and fixtures. An agent cannot select or alter its own validator. Existing profile-1 projects stay on that profile; adding different routing inputs does not silently migrate trust.

## Review and pin

The CLI resolves an existing provider executable and subscription login. No API keys, tools, MCP, network or repository workspace access are granted to the author operation. The tool supplies a versioned prompt with routing facts, the graph validator/template, a source manifest and up to twelve source examples (64 KiB total). Full app config and environment files are excluded. It makes at most three requests with 120-second request deadlines; malformed drafts receive a bounded diagnostic repair prompt. Transport failure or cancellation stops the operation. Receipts retain requested/observed identity and reported token usage; subscription monetary cost is unknown. Claude effort is requested but not independently attested.

Generated code is saved under ignored `.wayfinder/local/adapter-init/`. Review all source files in the artifact shown by init. The arrow-key review defaults to **Cancel**. Only explicit trust of the exact artifact hash allows host execution. Code is run through the existing bounded supervisor, then checked against pipeline-owned conformance and current-source semantics before public configuration/graph publication. A repaired or edited draft needs its own trust; validation failure never silently approves replacement code.

In a script, supply preferences explicitly on the first call:

```sh
traverse init --provider codex --model gpt-6.1-sol --effort medium --json
```

For a missing adapter this returns exit1 with `ready:false`, the candidate path/hash and `adapter.resumeArgs`. Inspect the candidate, then run the printed init command with `--adapter FILE --trust-adapter SHA256`. Keep the same preference flags if you want those defaults saved. There is no scriptable blanket trust flag. `--adapter` without its matching hash prepares a review result and cannot execute the candidate. `--dry-run` and `--check` never author, execute candidates or write staging state.

After acceptance, commit `.wayfinder/project.json`, `.wayfinder/extractor/artifact.json`, `.wayfinder/graph.json` and optional settings/guidance. Local host trust and execution receipts stay ignored. A clone can inspect a current graph without executing the adapter, but executing custom code on a new machine needs local exact-code trust again. Run `traverse init` to review the pinned adapter without generating it again. `graph refresh` and `graph watch` never invoke an author. Source changes use the same accepted deterministic code; changed framework/configuration, code, parser or validator identity requires compatibility review/reacceptance.

## Loading and cancellation

Init labels the current operation, including provider connection, authoring, independent validation, graph refresh and settings/guidance changes. Supported colour terminals show an indeterminate spinner only during actual asynchronous work. Inputs stop the animation; success, failure and cancellation clear its timer and line. Pipes, CI, `NO_COLOR` and `TERM=dumb` get finite plain progress; JSON has no progress or terminal escapes. Ctrl-C cancels owned provider/extractor processes and restores terminal input. Private failure receipts remain available; cancellation before Save makes no writes, and cancellation or failed validation before publication preserves public project state.
