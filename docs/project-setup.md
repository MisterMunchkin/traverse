# Guided project setup

Run `traverse init` inside a supported Expo project in an interactive terminal. This single command creates the repository graph and configures project preferences. The wizard uses Up/Down and Enter for choices, editable inputs for model and limits, Esc to go back, and Ctrl-C to cancel. Project files are written only after you select **Save project setup**; cancelling a fresh init leaves even `.wayfinder` absent. Reruns prefill existing values; cancelling preserves existing settings and agent guidance.

The wizard asks for Codex or Claude, a model from that CLI’s live catalog, reasoning effort, default driving mode, maximum UI actions per run and driving timeout in seconds. Each attempted tap, field fill, scroll or Back counts as one action, including failed attempts. Screen checks and model decisions do not count. Defaults are local-first, 20 UI action attempts and 120 seconds. `local-first` uses tev1 and escalates uncertain decisions to the selected frontier CLI; `frontier` sends every choice to it. Each frontier decision receives the current UI, shared repository graph, goal, inputs, offered controls and recent history. The same agent-device session continues after the decision.

Settings are saved in **`.wayfinder/settings.json`**, beside the source/graph configuration. Commit this file for project-wide defaults. Change `frontier.provider`, `frontier.model`, `frontier.effort` or `driving.policy`, `driving.maxSteps`, `driving.timeoutMs` there, or rerun `traverse init`. The file stores timeout in milliseconds; the wizard displays seconds. Unrelated top-level settings survive updates. Changing these defaults does not stale the source graph.

```json
{
  "schema": "wayfinder-settings/1",
  "frontier": {"provider": "codex", "model": "gpt-6.1-sol", "effort": "medium"},
  "driving": {"policy": "local-first", "maxSteps": 20, "timeoutMs": 120000}
}
```

The app instance is chosen on each run: platform, device/app ID or browser URL, session name and recording. Init does not save targets or recording defaults. Machine-model acquisition remains separate: plain `traverse setup` installs the managed tev1 cache once per machine. Project setup does not download models, install provider CLIs or change provider-global configuration.

## Optional agent guidance

After driving preferences, choose **Install shared skill** or **Skip** with the arrow keys and Enter. Esc revisits the choice before the final save. Fresh projects default to Skip. Reruns preselect intact Traverse-managed guidance, including older integrations awaiting migration. This choice is independent of the frontier provider.

Traverse keeps one skill at **`.agents/skills/traverse/SKILL.md`** and points to it from a short managed section in **`AGENTS.md`**. It creates no `.claude` skill or `CLAUDE.md` file. The packaged skill explains graph freshness, local/global CLI invocation, task expectations, owned targets/sessions, recordings, outcomes and frontier handoffs. It uses the repo dev dependency when present, without fetching a registry package. Commit the skill and AGENTS.md with your project; they install no global skills, agent CLIs or hooks. Start a new agent session if its skill list has not refreshed. Discovery does not guarantee invocation on every task.

Claude's [native skill discovery](https://code.claude.com/docs/en/skills) uses `.claude/skills`, so this shared skill is reached through repository instructions rather than that native skill picker. Current Claude Code can load root AGENTS.md, but existing project/ancestor CLAUDE instructions can take precedence. If yours do, add `@AGENTS.md` to your own CLAUDE.md as described in [Claude's memory documentation](https://code.claude.com/docs/en/memory). Older versions may also need this import. Traverse does not create or change that compatibility import.

Installing shared guidance migrates intact older Wayfinder copies: it removes managed `.agents/skills/wayfinder/SKILL.md` and `.claude/skills/wayfinder/SKILL.md` files, updates the shared instruction pointer and removes the separate legacy managed section of `CLAUDE.md`. A separate regular CLAUDE.md containing only that generated section is removed; an instruction alias keeps its target file present, even if empty. Surrounding custom instructions and unrelated files survive. Empty directories may remain. Existing canonical guidance is updated in place. Identical reruns preserve bytes. **Skip leaves all existing guidance unchanged**, including older copies. Rerun init or use `--agents shared` to install/update/migrate.

`AGENTS.md` and `CLAUDE.md` may be file symlinks to existing instruction files inside the project. Traverse preserves those links and edits each resolved file once; shared guidance and legacy cleanup of the same file become one update. The change summary names the actual target. External targets, dangling/cyclic chains, symlinked parent directories and symlinked skill paths are refused.

Generated skills and instruction sections carry content checksums: init refuses an existing custom Traverse skill, edited managed content, malformed blocks, oversized/non-file destinations or selected files changed during the wizard. Instruction bytes and alias targets are rechecked before saving, including when a new target has identical content. Preserve custom content elsewhere before replacing it deliberately; there is no force-overwrite option. Keep project-specific policy outside the managed section.

Guidance conflicts are preflighted before initialization writes. A later I/O error may leave an incomplete initialization; preserve its error and rerun after fixing the cause. The operation does not promise a transaction across the graph, settings and all guidance files.

## Scripted setup and run overrides

Piped input, CI, `TERM=dumb` and `--json` never open the wizard. Without preference flags, these calls retain the graph-only initialization contract. Supply all three frontier fields to initialize preferences on first use:

```sh
traverse init --provider codex --model gpt-6.1-sol --effort medium --json
traverse init --provider claude --model claude-opus-5-5 --effort high --json
traverse init --agents shared --json
traverse init --agents shared --dry-run --json
traverse init --agents shared --check --json
traverse init --check --json
```

`--dry-run` validates a preview without saving. `--check` checks project/graph state and validates saved preferences when present; it takes no preference overrides. Graph-only projects may omit preferences. `--agents shared|skip` explicitly selects optional guidance without opening the wizard; combine it with preference flags when needed. Without `--agents`, scripted init never installs guidance. With `--agents`, preview/check also inspect those selected guidance files; check fails if they are missing, out of date or still have old managed Claude copies, and neither mode writes files. `--no-interactive` explicitly keeps graph-only initialization and cannot be combined with preference flags or agent installation (`--agents skip` is allowed). Fresh projects need no separate initialization step. Use `--project /absolute/path` from another directory; there is no parent/sibling discovery. Compatible reruns preserve unchanged settings bytes. Unknown schemas, conflicting ignore blocks, symlinks and concurrent edits are refused with existing state preserved.

`setup --project DIRECTORY` remains compatible for editing preferences on an already initialized project, but `init` is the normal entry point.

For a repository dev dependency, prefix these commands with `npm exec --` (for example, `npm exec -- traverse init`). Commit the packaged tarball and dependency lockfile; CLI installation is repo-local, while optional machine-model installation stays in the shared user cache. See the [installation guide](../README.md).

`drive` reads saved defaults. Override `--policy`, `--max-steps`, `--timeout-ms`, `--provider`, `--model` or `--effort` for one run without saving. Changing provider requires an explicit model **and** effort for that provider. An explicit `--frontier-config FILE` uses the existing external command integration instead; it cannot be combined with provider/model/effort run flags. Older projects with no settings still work with an explicit external frontier, or return a saved escalation when none is configured.

## Provider prerequisites and evidence

Install and sign in to the selected CLI separately (`codex login` or `claude auth login`), using its existing subscription. Traverse resolves `codex`/`claude` from absolute PATH entries; settings never contain executable commands or credentials. Doctor checks saved settings and executable availability without starting either CLI or making an inference. Actual login, model access and protocol compatibility are checked when driving needs the provider.

Conflicting shell provider-routing and effort variables are removed for these subprocesses; Claude authentication must report the first-party OAuth provider. Codex search is explicitly disabled before startup and in the thread configuration. Codex uses app-server stdio, checks subscription authentication and available model/effort capabilities, and verifies the returned model/effort. Claude uses structured print output, exact model identity and disabled tools/customizations. The picker reads Codex’s paginated `model/list` (including hidden entries) and Claude’s initialization `models` metadata. It shows each distinct model and its supported effort levels, preserving provider order. Claude aliases are resolved to exact wire IDs before saving; switching modes such as `opusplan` are not single-model configurations. Model availability depends on the installed CLI, account and organization policy; a catalog entry alone is not proof of access. Metadata discovery sends no model prompt or generation request.

Use ↑/↓ to scroll through models, then Enter to select. Lists longer than the viewport scroll with the selection. The current saved model remains available even if it is absent from today’s catalog. Choose **Enter an exact model ID…** for other supported IDs. If discovery fails, init explains how to update/sign in and still allows manual entry; Esc back to the provider and Enter retries discovery. Older Claude builds without exact-ID metadata need updating or manual entry. At use time, unavailable Claude metadata is recorded and the manual exact-ID path still checks subscription authentication and the returned model. Invalid protocol messages or tool requests fail closed and require a CLI update. No project preferences are written until the final Save; Ctrl-C also cancels and reaps any pending metadata process.

Effort choices follow the selected model’s catalog capabilities. **Provider default (no effort override)** is used for models with no advertised effort levels. `--effort default` also works in scripted configuration: Claude omits the override; Codex resolves its catalog default and verifies the returned effort. Settings accept future exact IDs and effort labels without a Traverse release; metadata/CLI checks at use time reject incompatible selections. Manual IDs without capability metadata show common levels plus provider default; this is not a support guarantee. Managed account policy can still cap effort: Claude output does not attest effective effort, so receipts retain the request and mark effective effort unverified.

Clients are fixture-tested against Codex0.163.0 protocol and Claude Code2.1.292 print shapes. Real subscription inference through these new clients remains unverified. They reject tool requests, model fallback and unoffered choices; they do not retry failed decisions. Every request has a bounded owned process group. Evidence under `.wayfinder/local/sessions/NAME/drive/frontier` includes requested preferences, executable/version identity, request, protocol or process output, usage and result/failure. Provider-managed login remains in that CLI's own configuration; raw auth/config responses are not copied into receipts. UI text and entered values do appear in request evidence.

Subscription token usage is provider-reported. Billed cost stays `null`; Claude's reported API-equivalent cost is recorded separately and is not a subscription charge. Live UI/native integration and playback remain separately unverified; configuring a CLI does not claim those tests passed.

## Missing routing adapters

Init can use the selected provider/model/effort to create a missing supported navigation adapter. Traverse writes the prompt, shows actual-stage loading and requires exact-code review before independent validation. Refresh/watch reuse accepted code without an author. See [managed adapters and profile limits](adapters.md). Unknown frameworks do not become ready merely because an agent can generate code.
