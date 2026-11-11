# Managed navigation adapters

`traverse init` owns the author prompt and response contract. A compatible bundled or locally accepted adapter is reused. When a supported routing profile has no adapter, init uses the selected Codex or Claude subscription CLI, model and effort from the wizard or `.wayfinder/settings.json`. It never asks you to write a prompt or an author-config file.

## First supported profiles

All profiles produce `traverse-navigation` inventories with `schemaVersion: 1`, a partial static source inventory with source locations, guards and unresolved targets. None proves runtime visibility or business effects.

- `expo-source-inventory/1` preserves the original static SDK57 example profile and its bundled extractor.
- `expo-source-inventory/2` supports installed/declared/npm-locked Expo57 and Expo Router57, `expo-router/entry`, `app/` or `src/app/`, project-relative wildcard aliases and static Router facts inside `app.json`, `app.config.js`, `.ts`, `.mjs` or `.cjs`. Metro/Babel config files are fingerprinted without execution. Non-source assets are excluded from source inventory. Unknown or dynamic routing facts are rejected with a specific reason.

JavaScript/TypeScript app config must export a static object (`module.exports` or `export default`). Environment expressions outside routing facts are not evaluated or sent to the author. Function-exported config, unresolved routing spreads, conditional Router declarations, dynamic Router options, custom route roots, other framework/version combinations and other package managers need additional independent profile support. Conditional plugin-list branches with statically known non-Router identities are inspected without selecting a branch; a conditional Router or unknown spread is rejected. The tool never executes configuration to guess its result.

The Expo milestone adds the managed authoring path and a host-owned profile registry, not a universal framework adapter. TanStack Router and other routers cannot report ready until a host-owned profile supplies compatibility rules, independent semantic validation and fixtures. An agent cannot select or alter its own validator. Existing profile-1 projects stay on that profile; adding different routing inputs does not silently migrate trust.

## Next App Router first slice

`next-app-source-inventory/1` adds a bounded React web extraction profile for issue [#1](https://github.com/MisterMunchkin/traverse/issues/1). It uses the existing review, independent validation, graph publication and refresh/watch path. It requires local exact-code trust like Expo profile 2; it does not get Expo profile 1's automatic bundled trust. Navigation, drivers, TEV1 and distribution are unchanged.

| Input/pattern | Supported scope |
| --- | --- |
| Versions | Next **16.0.x or 16.4.x**, React and React DOM **19.2.x** with matching React patch versions. Root `dependencies`, npm lockfile v2/v3 and installed package manifests must agree. Declarations are exact or tilde patch ranges; no caret, prerelease, workspace or alternative lockfile detection. Legacy synthetic cases retain Next 16.0.11. The runnable fixture pins Next 16.4.6, React/React DOM 19.2.9. These are extraction compatibility claims, not all-version/runtime certification. |
| Roots/files | Exactly one `app/` or `src/app/`, with a root `layout.js/jsx/ts/tsx`; direct function/arrow default exports (or a local function identifier). Only `page.js/jsx/ts/tsx` creates a node. Layouts contribute declared sites to descendant pages. Colocated helpers, route handlers and assets do not become screens. Private `_` folders do not create screens. |
| Route paths | Static and nested paths, `(group)` identities with group-free URLs, `[id]`, terminal `[...slug]` and `[[...slug]]`. Parameter names stay in the existing node ID/URL pattern; no parameter value or auth state is invented. Literal paths select static segments before dynamic/catch-all segments. Conflicting group URLs remain ambiguous. |
| Navigation | Default `next/link` imports (including renamed imports), `const router = useRouter()` and named aliases from `next/navigation`: `push`, `replace`, `back`, `redirect`, `permanentRedirect`. Link/redirect map to the existing `Link`/`Redirect` methods. Literal strings and conditionals with two statically resolved branches are supported. Query/fragment text is retained in the target; its pathname selects the route. |
| Guards/ownership | Enclosing `if`, ternary, `&&` and `||` conditions annotate sites/edges; conditional layout redirects remain redirects with source evidence. They do not establish node authorization or prove reachability. JSX-used local components and their local value re-exports are followed at file level up to the existing depth of 8, including project-relative wildcard aliases. Supported forwarding includes named/default aliases, `export * from`, and imported identifiers forwarded through named or default exports. Barrel files remain in `componentPath`; cycles are visited once and type-only dependencies are excluded. File-level ownership can overapproximate which export renders; this is not symbol-level export resolution. |
| Static configuration | No Next config, or one direct empty `export default {}` / `module.exports = {}` config. Optional `tsconfig.json` or `jsconfig.json` permits project-relative wildcard aliases with one target, no inherited config or overlapping prefixes. All `baseUrl` settings, including `'.'` and `'./'`, are rejected: use relative imports or explicit wildcard aliases instead. `./*` covers the bounded `app`, `components`, `src` inventory; other alias directories are included explicitly. Source/config/package fingerprints retain input changes without exposing config text to adapter authors. |

Computed/template/variable/URL-object hrefs, partly dynamic conditionals and spread Link props remain `dynamic-target` facts. Missing, relative, external and ambiguous targets and history-dependent back actions have the existing unresolved reasons and source locations. No generic JSX parse implies another router is supported. Unsupported versions, mixed roots, duplicate page/layout files, missing inputs, syntax errors, unresolved local component imports/re-export targets and shadowed navigation bindings fail with diagnostics. App configuration is never evaluated.

**Deferred:** React Router declarations (a separate profile), Next Pages Router, other Next/React version lines, custom roots, basePath/i18n/rewrites/config redirects/pageExtensions, middleware/proxy, parallel/intercepting routes, grouped root layouts, lazy/generated default exports, namespace/router reexports, imperative helper call graphs, destructured router methods, router.forward and path-relative URL resolution. Component props, early-return control flow, effect timing and server-action reachability are not modeled. Vue/Nuxt, arbitrary React Native/React Navigation, Angular, SvelteKit, Flutter, SwiftUI/UIKit and Android navigation remain candidates from issue #1.

Try the isolated [Next fixture](../fixtures/next-app/README.md). The fixture is an app for extraction/QA, not the Traverse website. The official [App Router conventions](https://nextjs.org/docs/app/getting-started/layouts-and-pages), [dynamic segments](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes) and [useRouter API](https://nextjs.org/docs/app/api-reference/functions/use-router) inform this bounded profile; passing synthetic fixtures is the support evidence.

## Review and pin

The CLI resolves an existing provider executable and subscription login. No API keys, tools, MCP, network or repository workspace access are granted to the author operation. The tool supplies a versioned prompt with routing facts, the graph validator/template, a source manifest and up to twelve source examples (64 KiB total). Full app config and environment files are excluded. It makes at most three requests with 120-second request deadlines; malformed drafts receive a bounded diagnostic repair prompt. Transport failure or cancellation stops the operation. Receipts retain requested/observed identity and reported token usage; subscription monetary cost is unknown. Claude effort is requested but not independently attested.

Generated code is saved under ignored `.wayfinder/local/adapter-init/`. Review all source files in the artifact shown by init. The arrow-key review defaults to **Cancel**. Only explicit trust of the exact artifact hash allows host execution. Code is run through the existing bounded supervisor, then checked against pipeline-owned conformance and current-source semantics before public configuration/graph publication. A repaired or edited draft needs its own trust; validation failure never silently approves replacement code.

In a script, supply preferences explicitly on the first call:

```sh
traverse init --provider codex --model gpt-6.1-sol --effort medium --json
```

For a missing adapter this returns exit1 with `ready:false`, the candidate path/hash and `adapter.resumeArgs`. Inspect the candidate, then run the printed init command with `--adapter FILE --trust-adapter SHA256`. Keep the same preference flags if you want those defaults saved. There is no scriptable blanket trust flag. `--adapter` without its matching hash prepares a review result and cannot execute the candidate. `--dry-run` and `--check` never author, execute candidates or write staging state.

After acceptance, commit `.wayfinder/project.json`, `.wayfinder/extractor/artifact.json`, `.wayfinder/graph.json` and optional settings/guidance. Local host trust and execution receipts stay ignored. A clone can inspect a current graph without executing the adapter, but executing custom code on a new machine needs local exact-code trust again. Run `traverse init` to review the pinned adapter without generating it again. `graph refresh` and `graph watch` never invoke an author. Source changes use the same accepted deterministic code; changed framework/configuration, code, parser or validator identity requires compatibility review/reacceptance.

Implicit custom-extractor execution grants live outside the repository in
`$XDG_STATE_HOME/traverse/extractor-approvals`, or
`~/.local/state/traverse/extractor-approvals` when `XDG_STATE_HOME` is unset.
The state base must be an absolute owned path outside the app repository.
Grant directories and files must remain private; unsafe ownership, writable
ancestry, symlinks and linked grant files are refused. Grants bind the canonical
project path, exact extractor bytes, compatibility and execution environment.
Copying `.wayfinder/local/acceptances` does not transfer permission: those files
are diagnostics. Existing repository-local receipts are not migrated into
grants. Review the pinned custom adapter again with `traverse init`, or
deliberately supply an explicit reviewed `graph refresh --accepted FILE`.
After approval, compatible reruns and refresh reuse the private grant with zero
author calls. Moving a checkout requires approval at its new canonical path.

## Loading and cancellation

Init labels the current operation, including provider connection, authoring, independent validation, graph refresh and settings/guidance changes. Supported colour terminals show an indeterminate spinner only during actual asynchronous work. Inputs stop the animation; success, failure and cancellation clear its timer and line. Pipes, CI, `NO_COLOR` and `TERM=dumb` get finite plain progress; JSON has no progress or terminal escapes. Ctrl-C cancels owned provider/extractor processes and restores terminal input. Private failure receipts remain available; cancellation before Save makes no writes, and cancellation or failed validation before publication preserves public project state.
