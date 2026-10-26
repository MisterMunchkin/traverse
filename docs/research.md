# Research behind Traverse

The experiments asked whether a small local decision model could handle routine UI choices while a frontier model planned tasks and handled escalation. The most useful completed browser study reduced matched driving time and frontier usage. It did not establish general reliability, real-app safety or native-driver performance.

These are historical lab experiments from October 2026, preceding the maintained Traverse package. They use different corpora and policies; do not pool their denominators or treat successive scores as a learning curve. The [aggregate data](research/results.json) carries study identifiers and SHA-256 hashes of the original aggregate artifacts. Original private filenames are omitted; the hashes identify retained evidence, not public downloads.

## Fresh browser comparison — 21 October 2026

The fixture used navigation derived from app source, with synthetic records, forms and modal semantics. Twelve new source start/target pairs were excluded from the earlier 24 source cases. Six goals per role covered four navigation tasks and two each Save, discard, delete and cancel-delete. Each arm ran each goal twice, counterbalanced: 48 scheduled and retained attempts.

Both arms used `gpt-6.1-sol` at medium effort, the same repaired browser driver, public goals, live DOM candidates, supplied partial graph, effect history and action/time budgets. The control made zero tev1 calls. Assistance used the original shared-map `tev1:4b`, margin 0.819, confidence floor 0 and a 1,500 estimated input-token cap. The existing single-option `none` fallback and frontier escalation were retained. No inference retries or policy tuning occurred during the comparison.

| Measurement | Sol alone | Sol + tev1 |
| --- | ---: | ---: |
| Completed / retained | 23/24 | 24/24 |
| Frontier calls | 84 | 10 |
| Frontier input tokens | 1,206,982 | 143,528 |
| Frontier output tokens | 1,512 | 180 |
| Local queries | 0 | 86 |
| Local input / reported scored output tokens | 0 / 0 | 82,098 / 86 |
| Available recordings | 23 | 24 |
| Observed unsafe fixture outcomes | 0 | 0 |

On the 23 common completions, driving took 567.637 s alone and 318.429 s assisted: 43.9% less. Assistance completed one additional attempt, so its all-attempt driving total of 334.145 s is a different denominator. All-attempt frontier input fell 88.1%; requests fell 88.1%. There was no unknown reported model usage. These token counts are not an invoice: subscription charges, local hardware and energy costs were not measured. Frontier context was large, roughly 14,000 input tokens per call, contributing to the savings.

The sole control failure was a 15 s browser-open timeout followed by a 15 s screenshot timeout, before driving/model calls. Its roughly 30.24 s total remains counted in the failed outcome and all-attempt elapsed time; no recording exists. We cannot attribute it to Sol or credit tev1 with preventing it. Driving-only times exclude startup/preparation; total recorded attempt time was 817.111 s alone and 564.392 s assisted, including that failure. Neither timing is a latency distribution.

Real clicks/fills were checked against observed DOM and a server-owned UI event journal. The final audit reconciled 170 decisions/actions, 186 UI events and 16 confirmed fills. All 47 available recordings were probed and paired playback was checked. This verifies the fixture workflow, not production app screens, authorization, native prompts or the newly packaged agent-device runner.

## Earlier driving results

The historical Opus 5.5 pilot series had two fixture goals repeated three times per arm: tree-only 6/6, tree plus tev1 6/6, screenshot reference 2/6. Mean frontier API-equivalent cost per attempt was approximately $0.2052, $0.1129 and $0.1711 respectively. The assisted tree arm used about 45% less estimated frontier cost at equal observed completion. These estimates exclude local hardware costs and are not measured subscription charges. Two goals cannot support a general tree-versus-screenshot claim.

The first Sol browser pilot retained 24 attempts: control 12/12, assisted 11/12. Matched driving time was lower for assistance, but it did not maintain completion parity. That pilot and its input-delivery follow-up are separate from the repaired-driver fresh comparison; they are not pooled into its 48 attempts. Earlier device timings also varied by task: local calls that all escalate pay for both models. The planned 108-attempt native comparison was not completed; it supplies no model ranking.

## Representation and policy findings

These device-free studies advance synthetic state machines after accepted actions. They exercise selection logic, not physical UI input.

| Study | Recorded result | Interpretation |
| --- | --- | --- |
| Shared graph vs graph per option | 40/48 vs 25/48 completed; 24 authored goals, two repeats per layout | Repeating overlapping context was worse on this corpus. Send one shared graph within each request, again after the next observation. |
| Flat / grouped / text-encoded 3D regions | 40/56, 42/56, 40/56 solvable completions; each arm also had 8 negative attempts | Grouping's gain was one case repeated twice. Coordinates added about 40.1% input tokens over flat with no completion gain; this did not evaluate a learned tensor/graph encoder. All arms wrongly admitted entry on 8/8 negative attempts. |
| Navigation-only portability check | Each of three specialized guarded arms completed 0/48; original shared-map control 46/48 | A record-preservation grammar rejected all navigation-only goals before model calls. This was a host input-contract failure, not worse model reasoning or a speed win. |

Other diagnostics found confident wrong-item actions and low margins between multiple valid routes. Lowering a margin threshold admitted both useful and unsafe actions. Explicit effect wording reduced unsafe execution in one study by causing extra abstention; it did not improve ranking or goal completion. Graph freshness, route reachability, remaining budget and the truth of declared effects are separate questions. In-memory refresh experiments do not measure real extractor costs or validate semantic truth.

The public-map guard was deliberately narrow. Its record-constraint grammar must not be presented as a general safety policy or silently enabled for unsupported goal types. The later real-browser comparisons used the original shared-map ranker and frontier escalation, not that specialized guard.

## Limits and next validation

The fresh fixture's paths were only 1–2 navigation hops with 3–6 supplied edges. New pairs on a known graph and reused synthetic workflows are not a held-out application. Two repeats on an active host do not establish independent samples, tail latency, a calibrated acceptance threshold or a model leaderboard. No unsafe fixture effect observed is not proof of safety.

The studies used frozen historical runtime/model identities. The current installer pins Ollama 0.40.8 and `tev1:4b-q8_0`; installation and offline contract checks do not transfer these benchmark scores to a new runtime, quantization or device. Native UI, iOS/Android system dialogs, broader framework support and actual subscription-cost savings need separate validation.

A useful next study would compare the same frontier-only control against assistance on a held-out browser app or real UI, retaining every failure/timeout, unknown usage, observable effect and available recording. Model names, effort, supplied graph, driver and budgets should remain matched.

## Evidence included here

`research/results.json` is a compact projection of five recorded aggregate summaries: fresh browser, earlier browser pilot, graph layout, feature regions and navigation portability. It includes outcomes, usage and source hashes without home-directory paths, app-source excerpts, raw prompts or recordings. The Opus figures come from the historical experiment recap, whose artifact hash is retained under `sourceNotes` in that file.

Full raw request/action logs and recordings remain in the original local research archive and are not distributed in the npm package. The aggregate subset makes the headline arithmetic inspectable; it is not a standalone reproduction kit or a publicly downloadable video collection. A clean, redistributable benchmark fixture and raw-evidence release would be separate preparation.
