# Native local-choice context: design decision required

Status: proposal only. Native QA found that even a one-route source window exceeds the existing local-choice budget. This note proposes experiments; it changes neither the 1,500 estimated-token ceiling nor the 0.819 acceptance margin and makes no claim that native local decisions are validated.

## Problem and evidence

In the CV-6968 Traverse 0.13.0 rerun, every local-first decision escalated `CONTEXT_LIMIT`; tev1 made no decision. In the supplementary one-route `screenMap` run, the window omitted 134 of 138 graph nodes. The receipt reports 2,803 estimated tokens for the whole windowed request. UI, goal and other non-graph input reserved 963, leaving a 537-token graph allowance. The graph contribution is therefore approximately 1,840 estimated tokens (2,803 minus 963), not 2,803. Shrinking the route count alone therefore does not establish that the remaining semantic facts fit. No model-ranking failure was observed: the model was never asked.

Evidence reference: the owner-provided QA brief, T3, and `rerun-013/traverse-sessions/v3-ios-supp-a1-dismiss-screenmap-*/` context-window receipts. Raw screens, prompts and app source remain private; they must not be copied into this repository. These estimates describe one recorded request, not a tokenizer guarantee or a representative native distribution.

`src/driving/context.mjs` retains owner edges, redirect closure, destination guards, registrations and relevant unresolved sites. `src/driving/policy.mjs` budgets the shared request before local inference. Dropping those facts indiscriminately could make an action appear unguarded or reachable when the source says otherwise. A screenMap is a visible-selector association, not runtime route attestation.

## Options

### A. Keep escalation as the supported behavior

Retain the current representation and limits. Report context rejection and its startup cost clearly. This is the lowest semantic risk, but provides no local-decision benefit on the observed screens.

Validation: replay a redistributable synthetic reduction through the current budgeter and prove that no local query occurs when over budget. In an owner-approved native comparison, count all escalations and model startup time, including failures. This is the baseline for every representation experiment, not a speed win attributed to tev1.

### B. Lossless compact serialization of the same selected facts

Prototype a versioned encoding that removes repeated field names and repeated identities while retaining every selected semantic fact, guard, unresolved relation and graph-scope marker. Keep one shared graph per decision. Bind the encoded input to the existing full graph hash and save a decoding/selection receipt. Do not treat a shorter string as equivalent model behavior merely because it is mechanically reversible.

Validation: first perform a fixture-only, no-model budget breakdown of UI, goal, options, history and each retained graph collection. With the recorded reservations unchanged, fitting the graph contribution would require about a 71% reduction; stop and report infeasibility if preserving the facts cannot achieve it. Keep the current character-based estimator over the full local-choice input as the ceiling gate, and report actual tokenizer or provider input tokens separately when model runs are authorized; reducing the heuristic alone is not evidence of improved tokenization.

If feasible, prove round-trip preservation on synthetic graphs with redirects, duplicate labels, conditional edges, unresolved destinations and ambiguous screen matches. Measure the entire serialized request, not graph nodes alone. Then rerun matched baseline and compact arms on a redistributable reconstruction of the historical fixture plus held-out larger graphs. Keep model/runtime, quantization, goal, driver, budgets, 0.819 margin and 1,500-token ceiling fixed. Compare completion, wrong-item/unsafe effects, abstention, escalation, latency and total usage, retaining all attempts. Historical aggregate totals alone cannot reproduce the original study.

### C. A smaller decision-specific semantic contract

Design a local-choice envelope that retains current UI actions, full goal constraints and the source facts needed for this decision, with explicit unknown/omitted semantics. An example is an in-screen dismissal that cannot establish a navigation effect. This would be a new policy contract, not a harmless serializer optimization; screenMap and action labels alone do not prove that dropping graph facts is safe. Any unsupported or ambiguous goal must escalate.

Validation: first specify admissible tasks and rejection rules. Include adversarial cases where visually identical buttons have different guards, duplicate labels, destructive effects or record-preservation requirements. Compare against the unchanged shared-map baseline on held-out goals. In particular, test navigation-only goals: the historical specialized guard rejected all of them before inference. A contract that avoids local calls by rejecting useful goals must report that loss, not claim increased safety or speed. Require separately approved native validation before adoption.

### D. Learn or summarize the context

A frontier-produced plan, learned graph encoder or lossy summary might compress further, but introduces an additional source of uncertainty and possibly frontier cost on every task. It changes the research question and requires a distinct experiment. It must never supply action authority or erase guard/unknown facts silently.

Validation: save the source context, summary and omitted facts; audit semantic loss independently. Count planner calls, tokens, latency and failed summaries in end-to-end results. Compare with frontier-only and unchanged local-first arms on identical retained tasks. Test prompt injection and contradictions between the summary and fresh UI. A fixture-only result would not establish native safety.

## Recommended next decision

Keep A as the supported fallback and authorize a bounded B experiment first. B offers an independently checkable semantic-preservation criterion without first inventing a new task grammar. If it cannot fit real-size synthetic reductions, return with measured budget components before considering C or D. Do not raise the ceiling, lower the margin, remove guards or substitute only controls as an implementation shortcut.

The owner must choose the experiment, redistributable corpus and separately authorized model/device execution scope. This docs-only proposal authorizes none of those actions. No success threshold has been retroactively selected from the CV-6968 outcomes.

## Research comparison and decision gate

The [research summary](../research.md) reports a fresh browser study with 48 retained attempts, short 1–2 hop paths and 3–6 supplied edges. It used the original shared-map policy with the same ceiling and margin; its results do not transfer automatically to a new encoding, model pin or native driver. The shared-graph versus per-option study also warns against duplicating context across choices. The negative guarded-navigation result and wrong-item diagnostics require explicit coverage in any new experiment.

Pre-register the corpus, all arms, model/runtime identities, repetitions, task/effect expectations and acceptance criteria before running. Require no observed regression in the predefined safety and completion checks, report uncertainty and per-task outcomes, and retain failure/timeout attempts in denominators. Record context bytes and estimated tokens, local calls/abstentions, frontier calls and provider usage, unknown accounting, startup and driving time, and observed effects. Do not equate a fitting request with a correct decision, or API-equivalent cost with a subscription charge.

Code work waits for the owner's decision and the experiment's evidence. Public aggregates in [results.json](../research/results.json) are comparison context, not a portable replay kit; unavailable original raw evidence must remain an explicit validation limitation.
