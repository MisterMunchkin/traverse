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

`--agent-device /absolute/executable` overrides PATH lookup. A session records the resolved executable, launcher hash and reported version, plus a unique underlying session and explicit target. The launcher hash is not a transitive dependency or installed-app build attestation.

## Inspect and act

From an initialized supported repository with a current graph:

```sh
traverse session open --session checkout-1 --platform web --app http://127.0.0.1:8081 --json
traverse session observe --session checkout-1 --json
traverse session act --session checkout-1 --action /absolute/action.json --json
traverse session close --session checkout-1 --json
```

Native open additionally requires `--platform ios|android --device ACTUAL_ID --app ACTUAL_BUNDLE_OR_PACKAGE`. Choose a fresh session name for each open. State/evidence is automatically created beneath `.wayfinder/local/sessions/NAME`, which init ignores. Sessions operate serially under an exclusive lock. A failed/closed name is retained as evidence rather than overwritten.

An observation includes `id`, capture time, explicit target, semantic fingerprint, normalized nodes, enabled/visible current controls and overlays. One unfiltered `snapshot --json` supplies both semantic verification and its own current refs; an interactive-only projection cannot prove text absence. It captures accessibility/DOM information now; it does not continuously watch the device. `graph watch` separately monitors repository sources. No route is inferred merely because it exists in source. Unrecognized/OS surfaces remain observed UI.

Example action file, using IDs returned by the actual observation:

```json
{"observationId":"ACTUAL_OBSERVATION_ID","type":"press","target":"ACTUAL_CONTROL_ID"}
```

For text use `type: "fill"` and `value`; scrolling uses `type: "scroll", direction: "down"` (also up/top/bottom); navigation uses `type: "back"`. Unknown fields/actions are rejected. Secure fields are not offered for automated text entry. Only the unique innermost active dialog authorizes controls; independent modal scopes with no provable order offer none. Noninteractive containers do not inherit their own lack of hittability into actionable descendants.

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

Selectors match exact label/role/identifier/value. All expectations must hold; fields must resolve uniquely. `absent` is also available. Expectations describe only the visible UI supplied by the snapshot; verifying durable database state requires a separately specified observable workflow. Inputs map exact field identifiers or labels to text; ambiguous/unmatched fields are not filled.

```sh
traverse drive --task /absolute/task.json --session profile-1 \
  --platform web --app http://127.0.0.1:8081 --record --json
```

Local-first requires an already verified `traverse setup` cache (`--cache-dir` overrides). It uses a private pinned Ollama process and stops that owned process group. There is no implicit model download or attachment to a shared daemon. Each decision includes one shared graph, current UI and the last eight actions. The local policy uses the researched 0.819 margin, confidence floor0, 1500 estimated token ceiling and23-control limit. One control also gets an abstention option. Too many controls/context, model outage or uncertain choice escalates without silently truncating the choices.

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

`elapsedMs` is the driving phase including app/session cleanup; `timings` also records preflight and total wall time including model startup/teardown. Accounting records local/frontier call counts, reported tokens and cost. Missing usage/cost is null with incomplete accounting. Reported cost covers frontier charges only; local compute cost is not priced. Standard exit codes:0 verified/success,1 failed/timeout,2 frontier handoff,130 cancellation (SIGTERM launcher exits143).

Doctor checks configuration readiness. Native UI validation status belongs in the run evidence and this coverage record; it is not an installation failure or a doctor gate. Installing a new archive is an explicit package update; it does not silently replace an existing global installation.

## Validation coverage

Managed official model acquisition and actual constrained-choice inference have been exercised on macOS arm64. Runner transport, stale targets, modal/field guards, bounded loop behavior and cleanup are verified with isolated fixtures. The actual packaged local-first model smoke returned LOW_MARGIN and took no UI actions; it was not a successful task. Live browser/native integration, durable business effects and recording playback still require their own observed runs. These limits do not make a correctly configured installation unhealthy.
