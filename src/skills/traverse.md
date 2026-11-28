---
name: traverse
description: Maintain this repository's Traverse navigation graph and run bounded UI tasks with agent-device, tev1 and frontier decisions. Use for app navigation, UI verification, recordings or graph freshness when Traverse is initialized here.
---

# Traverse

Use the repository's documented Traverse launcher and working directory for every command below. Check the repository instructions and setup guide first. For example, if the project uses `bun run traverse` from the repository root, run `bun run traverse graph check --json` there.

When the repository does not specify a launcher, work from the initialized app directory containing `.wayfinder/project.json`. If Traverse is installed as a repo dev dependency, use `npm exec --offline -- traverse ...`. Otherwise, use the installed `traverse` on PATH. If neither installation exists, ask for installation rather than fetching an arbitrary registry package. Consult `--help` through the selected launcher.

## Prepare the task

- Follow the repository's graph freshness and tracking instructions. Use `traverse graph check --json` to inspect readiness. If the repository has no custom graph workflow, use `traverse graph refresh --json` when the graph is missing or stale and inspect the result. If Traverse requests extractor approval, review the exact artifact through the project's setup procedure.
- Use `traverse doctor --json` to check configuration. The graph describes declared routes. Verify the running screen and build separately.
- Project defaults live in `.wayfinder/settings.json`: frontier provider/model/effort, driving policy, action limit and deadline. `traverse init` edits these; `traverse setup` acquires the per-user model cache separately. Do not change defaults or install models merely to run a task. One-run flags can override defaults.
- Select the actual app URL or bundle/package, platform and an owned device for this run. Use a fresh named session. Do not invent target IDs, launch unrelated apps, or shut down devices you do not own. Traverse delegates UI interaction to agent-device; it does not implement simulator creation/deletion.

## Drive and verify

Save a task JSON under ignored `.wayfinder/local/` with the user's goal, exact field inputs and observable expectations. For example:

```json
{"goal":"Save the profile name","inputs":{"Name":"Updated name"},"expect":{"visible":[{"label":"Saved"}],"fields":[{"label":"Name","value":"Updated name"}]}}
```

Use `traverse drive --task TASK_FILE --session FRESH_NAME --platform web --app ACTUAL_URL --json`; native runs use `--platform ios|android --device ACTUAL_ID --app ACTUAL_APP_ID`. Add `--record` when requested. Local-first uses the managed tev1 cache and escalates uncertain choices through the saved frontier CLI; `--policy frontier` uses only the frontier model. Follow the user's authorized action scope; a skill is not permission for external mutations.

Read the result and receipts under `.wayfinder/local/sessions/NAME`. Exit 0 / `status: verified` means the explicit visible expectations and cleanup passed. It does not prove durable backend state or untested native integration. Failed actions and timeouts count as failed attempts; do not blindly repeat an action whose effect is uncertain. Missing usage/cost stays unknown. Saved recording bytes are not proof of playable video; check `playbackVerified`.

Exit 2 is a saved frontier handoff, not a paused resumable drive. Read its brief, then use a newly observed owned session for subsequent manual actions or a fresh drive after resolving the cause. Do not claim completion from the graph or a model's choice alone.

For manual steps, `traverse session open|observe|act|close` exposes current UI and guarded actions. Observe is one snapshot, not a continuous watch. Use only target and observation IDs returned by the latest observation; inspect the next observation to verify the effect. `traverse graph watch` separately watches repository source changes.
