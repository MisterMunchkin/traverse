# Driving checkpoint

Traverse owns graph context, current choices, tev1/frontier policy and verification. The built-in runner uses agent-device for live UI and device commands. Its small internal contract is `open`, `observe`, `act`, recording/screenshot and `close`; it is not a public plugin API. Alternative runners would need the same observation, stale-target, uncertainty, deadline and ownership behaviour.

This guide describes the packaged runner and driving contracts. Help/version and graph extraction do not need agent-device or a model; validation coverage is recorded below.

## Device lifecycle

```sh
traverse device capabilities --json
traverse device list --platform ios --json
traverse device boot --platform ios --device ACTUAL_UDID
traverse device shutdown --platform ios --device ACTUAL_UDID
```

Use a discovered iOS UDID or Android serial, never an invented ID. These commands invoke agent-device directly; boot/shutdown require explicit selection. Create/delete capabilities are false because the inspected CLI provides no documented command for them. No simulator-control fallback is bundled. Automatic run cleanup closes its own app/session and preserves the device. Explicit shutdown is a separate targeted operation.

`--agent-device /absolute/executable` overrides PATH lookup. A session records the resolved executable, launcher hash and reported version, plus a unique underlying session and explicit target. Observe, act and close resolve the current explicit selection or PATH again and require it to match the recorded path and launcher hash; saved metadata does not select an executable. Repeat `--agent-device` for a custom runner outside PATH. Full session authority (target, underlying runner session and lifecycle state) lives in private user state outside the canonical project, under `$XDG_STATE_HOME/traverse/driving-sessions` or `~/.local/state/traverse/driving-sessions`. Repository `session.json` files are diagnostics only. Copied, legacy or moved sessions require a fresh `session open` with a new name; existing repository metadata is never imported as authority. Removing repository diagnostics does not free a private session name. Keep private state available until targeted cleanup completes. The launcher hash is not a transitive dependency or installed-app build attestation, and an operator-controlled PATH remains trusted input.

## Inspect and act

From an initialized supported repository with a current graph:

```sh
traverse session open --session checkout-1 --platform web --app http://127.0.0.1:8081 --json
traverse session observe --session checkout-1 --json
traverse session act --session checkout-1 --action /absolute/action.json --json
traverse session close --session checkout-1 --json
```

Native open additionally requires `--platform ios|android --device ACTUAL_ID --app ACTUAL_BUNDLE_OR_PACKAGE`. Choose a fresh session name for each open. State/evidence is automatically created beneath `.wayfinder/local/sessions/NAME`, which init ignores. Sessions operate serially under an exclusive lock. A failed/closed name is retained as evidence rather than overwritten.

Native semantic types are normalized independently of native class roles, with explicit supported Android widget mappings. Generic views are not assumed to be buttons; conflicting native semantics fail closed. Password fields, `visibleToUser: false`, and covered ancestors retain their restrictions.

Android requires per-node `bundleId` ownership for the requested package; the snapshot's top-level `appBundleId` alone is not foreground evidence. Foreign or mixed app nodes, missing ownership, an absent requested app, and unrecognized system windows reject the observation. This is conservative accessibility-window evidence, not an independent OS resumed-activity attestation. Permission dialogs, keyboards, split-screen and OEM layouts outside the recognized set may therefore stop driving; no fallback guesses the foreground app.

Recognized Android SystemUI status roots (`clock`, `mobile_combo`, `battery`), noninteractive status images within their vertical band, and the `navigation_bar_frame` subtree are excluded from app controls, expectations and fingerprints. App-relative node identities survive chrome insertion/removal, so clock and signal changes do not stale an in-app action. App text, state, geometry, visibility and modal changes still invalidate the action. Raw command receipts retain the original full snapshot for diagnosis. This projection has synthetic coverage; device revalidation remains pending.

An observation includes `id`, capture time, explicit target, semantic fingerprint, normalized nodes, enabled/visible current controls and overlays. One unfiltered `snapshot --json` supplies both semantic verification and its own current refs; an interactive-only projection cannot prove text absence. It captures accessibility/DOM information now; it does not continuously watch the device. `graph watch` separately monitors repository sources. No route is inferred merely because it exists in source. Unrecognized/OS surfaces remain in raw receipts; unsupported Android surfaces fail closed.

Example action file, using IDs returned by the actual observation:

```json
{"observationId":"ACTUAL_OBSERVATION_ID","type":"press","target":"ACTUAL_CONTROL_ID"}
```

For a hold use `type: "longpress"`, the current `target`, and optional integer `durationMs` (1–10000; default 800). The command releases before the next observation: a post-action snapshot does not verify appearance during the hold. For text use `type: "fill"` and `value`; scrolling uses `type: "scroll", direction: "down"` (also up/top/bottom); navigation uses `type: "back"`. Unknown fields/actions are rejected. Secure fields are not offered for automated text entry. When a native target specifies a bundle identifier and the snapshot reports a different bundle identifier, the observation is rejected even if it contains a dialog. A dialog does not grant authority over another application; a system-owned permission surface reporting another bundle remains rejected. Only the unique innermost active dialog authorizes controls; independent modal scopes with no provable order offer none. Noninteractive containers do not inherit their own lack of hittability into actionable descendants.

Before dispatch, act takes another snapshot. Semantic change rejects the action with a new observation; unchanged semantics use newly captured opaque refs, including any snapshot pin. There remains a race between the final check and platform dispatch. No atomic UI guarantee is implied. A command acknowledgement and its subsequent observation are separate receipt fields. A timeout after dispatch leaves the effect uncertain and never automatically repeats the mutation.

Existing session observe/act/close do not require a healthy/current source graph or parser; this allows inspection and cleanup after editing the app. New session and autonomous drive preflight require the initialized supported source profile and validated current graph. Runtime UI presence does not attest that the installed app was built from that source revision.

## Bounded goal execution

An explicit task file supplies an observable stop condition:

```json
{
  "goal": "Change the profile name and save it",
  "inputs": {"Name": "Updated name"},
  "expect": {
    "visible": [{"label": "Saved"}],
    "fields": [{"label": "Name", "value": "Updated name"}]
  }
}
```

Task `actionTypes` optionally selects a nonempty unique list of `press`, `fill`, and `longpress`; the default is `["press", "fill"]`. For a hold journey, use `"actionTypes": ["longpress"]` (or include press/fill for a mixed journey). Autonomous holds use 800 ms; manual action files can choose a bounded duration. The model receives explicit hold choices rather than inferring gestures from prose.

Selectors match exact label/role/identifier/value. All expectations must hold; fields must resolve uniquely. `absent` is also available. Expectations describe only the visible UI supplied by the snapshot; verifying durable database state requires a separately specified observable workflow. Inputs map exact field identifiers or labels to text; ambiguous/unmatched fields are not filled.

```sh
traverse drive --task /absolute/task.json --session profile-1 \
  --platform web --app http://127.0.0.1:8081 --record --json
```

Local-first requires an already verified `traverse setup` cache (`--cache-dir` overrides). It uses an owned pinned Ollama process bound to loopback, with an unauthenticated local API, and stops that owned process group. There is no implicit model download or attachment to a shared daemon. Each decision includes one shared graph projection, current UI and the last eight actions. Source provenance stays in the full graph saved in `inputs.json`; decision receipts bind the projection to its SHA-256. The policy first removes provenance without dropping semantic facts. Without a screen map, if still oversized, it retrieves all exact control-label or explicit goal-route/title matches, their owner facts, referenced nodes, guards, registrations, unresolved facts and automatic redirects. Retrieved context records omitted counts and never claims an observed current route. No reliable seed, or relevant facts that still exceed the budget, causes escalation. It does not silently remove controls, shorten the goal, or infer that omitted routes are irrelevant. The local policy uses the researched 0.819 margin, confidence floor 0, 1500 estimated token ceiling and 23-option limit. One control also gets an abstention option. Too many controls/context, model outage or uncertain choice escalates without silently truncating the choices.

### Moving screen windows

An optional task `screenMap` anchors each decision to freshly observed UI. Keys are exact **graph node IDs**, including route groups; they are not inferred URLs or a declaration that navigation succeeded. Values are conjunctions of exact visible selectors:

```json
{
  "goal": "Dismiss the notice, then open the profile",
  "screenMap": {
    "/": [{"identifier": "welcome-screen"}],
    "/profile": [{"role": "heading", "label": "Profile"}]
  },
  "expect": {"visible": [{"role": "heading", "label": "Profile"}]}
}
```

Replace these example routes and markers with those from your graph and current snapshots. Prefer stable accessibility identifiers (`testID` when exposed as an identifier); distinct headings can also work. No app instrumentation is installed automatically. A map is a task author's declared association, **not runtime router attestation**. Receipts record `visible-selector-match`, the observation and matching node IDs, map/graph hashes, and `runtimeRouteVerified: false`.

A map supports 1–256 routes with 1–8 selectors each. Every selector needs a nonempty label or identifier; role/value may narrow it. Fields match exactly and are bounded to 1000 characters. All route IDs must exist uniquely in the graph before a session opens. Every selector for a route must match a visible node, and only one route may be plausible. Duplicate markers remain ambiguous even when another route has unique markers. Hidden ancestors count as hidden; a dialog can sit above a still-visible underlying screen marker.

For a unique match, the window includes that route's outgoing edges, immediate destination nodes, their guards/registrations, unresolved alternatives and automatic redirect closure. Source sites are included only at the precise locations of retained edges/unresolved facts. Global visible banners and dialogs remain in UI context even when their buttons have no navigation edge. Window metadata records omitted counts; it does not assert that omitted routes cannot matter to the wider goal.

The full goal, all offered choices, visible UI facts, modal scope and up to eight recent actions reserve space first; the graph uses the remaining estimated 1500-token budget. Model UI rows omit refs, geometry, the always-true visibility flag, and null parent/identifier/value fields; absent parent means a root and absent identifier/value means unavailable. Labels, non-null values, hierarchy, enabled state and false/unknown hittability remain. Full observations and the complete graph stay in local evidence.

The window is rebuilt after every observation; a previous match is never reused. Missing or competing evidence produces `SCREEN_UNKNOWN` or `SCREEN_AMBIGUOUS` and bypasses local inference even for a small graph. An essential window that still cannot fit produces `CONTEXT_LIMIT`. Frontier requests and saved frontier handoffs expand a screen window back to the complete semantic graph, retaining the identity uncertainty and the original window receipt under `context.window` (including its budget and omissions). Expectations still determine completion independently; an action acknowledgement does not establish a new screen. Without `screenMap`, conservative label/goal retrieval continues as before.

Without a configured frontier provider or command, escalation returns exit2 and a saved self-contained brief. The run closes its session; this is a decision report, not a resumable paused execution. Use a newly observed session for subsequent manual actions, or run `traverse init` before running. No task is declared complete without the explicit expected UI state.

Run [guided project setup](project-setup.md) to select Codex/Claude, model/effort and defaults. The control is `--policy frontier`, using the saved provider (or an explicit `--frontier-config /absolute/frontier.json`); it makes no local model calls. Saved defaults apply unless overridden by run flags, without rewriting settings. Without project settings, default limits are20 dispatched actions and120000ms for the driving phase. `--max-steps` accepts1..100 and `--timeout-ms`1..1800000. Cancellation interrupts owned commands; cleanup has its own bounded command allowance.

## Frontier command boundary

The built-in boundary accepts an explicitly selected executable, not a shell string or a command silently read from repo configuration:

```json
{"schema":"wayfinder-frontier-command/1","command":"/absolute/executable","args":["/absolute/choice-wrapper.mjs"]}
```

The wrapper receives one JSON `wayfinder-frontier-choice-request/1` on stdin: goal, inputs, observation ID, shared state, offered `{id,description}` options, optional local escalation and a constrained response schema. It must choose an offered ID or `none`. It outputs one JSON object:

```json
{"pick":"c0","usage":{"inputTokens":123,"outputTokens":4},"costUsd":0.001}
```

Usage and cost are optional and retained as unknown when absent. Only `pick` is required for a decision; token/cost claims are provider-reported, not independently billed amounts. Local decision events retain the exact question and answer/error. A caller embedding the internal loop may instead supply its existing frontier callback. Built-in subscription Codex/Claude clients are also available through project setup; see its guide for exact model/effort, usage and validation limits. No public adapter registry is installed. Historical experiment harnesses are not required by the packaged clients.

## Results and evidence

`--json` emits one result on stdout. Human diagnostics/results go to stderr. The run directory contains graph identity, task/policy inputs, ordered events, model/frontier/device receipts, snapshots/actions, outcome and optional recording. It may contain real UI text and entered values; it stays under ignored local state.

`status: verified` requires all live UI expectations and successful cleanup. Timeouts/failures remain failed attempts. Acknowledged but unobserved actions remain uncertain. Model-server teardown or recording/close failure cannot leave a successful final report. Recording success requires a nonempty saved artifact; `playbackVerified: false` distinguishes saved bytes from verified playable video. Offline tests use fixture media, not real recordings.

`elapsedMs` is the driving phase including app/session cleanup; `timings` also records preflight and total wall time including model startup/teardown. Accounting records local/frontier call counts, reported tokens and cost. Missing usage/cost is null with incomplete accounting. `costUsd` retains the existing callback-reported cost contract; built-in subscription clients leave it null and do not infer subscription charges. Local compute cost is not priced. Standard exit codes:0 verified/success,1 failed/timeout,2 frontier handoff,130 cancellation (SIGTERM launcher exits143).

Doctor checks configuration readiness. Native UI validation status belongs in the run evidence and this coverage record; it is not an installation failure or a doctor gate. Installing a new archive is an explicit package update; it does not silently replace an existing global installation.

## Validation coverage

Managed official model acquisition and actual constrained-choice inference have been exercised on macOS arm64. Runner transport, stale targets, modal/field guards, bounded loop behavior and cleanup are verified with isolated fixtures. The actual packaged local-first model smoke returned LOW_MARGIN and took no UI actions; it was not a successful task. Live browser/native integration, durable business effects and recording playback still require their own observed runs. These limits do not make a correctly configured installation unhealthy.

## Security guidelines

Use a disposable development session with synthetic inputs. Read the
[security guidelines](security.md) for local model peer access, browser
navigation/frame limits, provider data sharing and private evidence handling.

### Provider-reported accounting

Claude's result-message counters are also retained separately in drive accounting: `frontierReportedInputTokens` sums `input_tokens`, `cache_creation_input_tokens` and `cache_read_input_tokens` exactly once; `frontierReportedOutputTokens` retains `output_tokens`. `frontierReportedCacheCreationInputTokens` and `frontierReportedCacheReadInputTokens` expose the cache subtotals already included in that input total. `frontierReportedApiCostUsd` sums the reported `total_cost_usd` API-equivalent cost, **not subscription charges**. These fields describe provider result reports, not independently verified usage, decision-model attribution or an all-model total. Per-model breakdowns remain in the request receipts; they are never added to overlapping result counters.

No frontier calls means zero. Once a call is attempted, each absent or invalid metric is null; any incomplete call makes that aggregate metric null, even if other calls supplied it. An input total requires all three input components, including explicit cache zeros. Failed requests remain unknown. Clients or callbacks without these reports leave the new fields null after a call. The existing `complete` flag describes the original attributed usage/cost fields; a populated provider report does not make unknown attribution complete.
