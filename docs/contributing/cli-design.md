# CLI design for humans and automation

Use a short, guided terminal experience and a stable machine interface. Apply this guidance within the user's task and authorization; it does not authorize publication, global installation, new adapters or new agent lanes.

This is a Node-oriented adaptation of the CLI Patterns skill. Its upstream Python framework choices, fixed exit-code numbers, JSON envelopes and resource-command naming are examples, not requirements for Traverse. Preserve existing contracts unless changing them is part of the task.

## Establish the command's contract

Identify who runs the command, what directory it acts on, what it changes, the expected result and what happens next. Separate installing the tool once from initializing each project. Explain their scopes in help; a global executable does not imply that every framework or project layout is supported.

Expose only implemented commands and capabilities. Package installation success, project readiness, source extraction and native UI driving are different states. A successful install should say what is ready and provide an executable next command. Detailed capability status belongs in `doctor`; required failures must still be clear. Never imply that installation provides an unfinished driver.

Reuse the existing parser, supervisor and output utilities before adding libraries. Keep package runtime dependencies inside its declared package boundary. A distributed package must not require this repository, a worktree, an author's home path or lab-only files.

## Human output

- Start with the task name and show the actual current step before potentially slow work. Mark a step complete only after its operation succeeds. Do not invent progress percentages, downloads or completed checks.
- End with one clear result and the next useful command. Distinguish fresh setup, an unchanged rerun, a preview and a failed check. Do not turn an idempotent rerun into an apparent new installation.
- Put internal file lists and debugging detail behind `--verbose` or in a named log. Retain the target location when users need it to choose or troubleshoot an installation.
- Use whitespace and restrained colour to separate status from detail. Colour must not carry meaning alone. Honour nonempty `NO_COLOR`, `TERM=dumb` and the tool's explicit colour option. Detect the actual stream's TTY; redirected or CI output must have no animation or unwanted ANSI control sequences.
- Keep finite step output simple. Introduce a spinner only for real waiting, and stop every timer on success, failure and interruption.

## Machine output and errors

Data goes to stdout; human progress, diagnostics and decoration go to stderr. `--json` must produce exactly the documented JSON result or documented streaming format, without banners, progress or coloured text mixed into it. Preserve the existing schema and established exit semantics. Help and version output should work without a project or optional model/device dependency.

Reject unknown flags and invalid inputs before mutation. Help should show a concise purpose, usage, flag defaults and copyable examples. Quote real paths in suggested shell commands; never fabricate a package name or hosted installer URL as though it exists.

An error states what failed, what the user can do, and where relevant diagnostics were saved. Avoid raw stacks by default and avoid lab implementation terminology in ordinary product flows. Keep useful stderr diagnostics available when structured JSON reports a failure. Credentials and config contents must not leak into logs or suggested commands.

Do not silently change exit code meanings to match an external checklist. In Node, set `process.exitCode` after required cleanup rather than exiting before writes or owned-child cleanup finish. Handle cancellation through the existing bounded supervisor; do not add a second timeout/ownership channel around it.

## Project state and installation

Create owned directories automatically. Preserve compatible configuration byte-for-byte on reruns; refuse unknown ownership, symlink escapes or conflicting state with a useful recovery path. `--dry-run` and read-only checks must not create directories or install dependencies.

Use explicit package/project identity and real source/config/dependency fingerprints. Do not weaken provenance or silently reaccept a changed runtime to make a relocated install appear healthy. An existing checkout-linked install needs a deliberate replacement path; preserve its source until the replacement is verified.

Keep project discovery bounded. Read supported static inputs; do not execute project configuration, scan sibling repositories, load credentials or claim support for an unimplemented router. Use explicit overrides when detection is ambiguous. Preserve reviewed-artifact trust boundaries even when simplifying setup.

Use exact dependencies and a lockfile. Test the actual package contents and the user's install command. Document update and removal scopes, avoiding deletion of user data or unrelated installations. Publication, PATH/profile edits and real global tool changes still require the user's authorization under repository policy.

## Evidence appropriate to the change

Before implementation, name observable completion and the checks that prove it. Relevant checks may include fresh setup, rerun/config preservation, partial setup recovery, an intentional failure, read-only modes and cancellation. Test meaningful behaviours rather than mirroring a formatter's private implementation.

For packaging, install or copy the built artifact to an owned directory outside the repository, make the checkout unavailable to the test through normal filesystem isolation, and exercise the supported commands there. Do not equate a successful source-tree invocation with a working distribution.

For terminal output, check the real process in a terminal/PTY and in piped/JSON/no-colour contexts. Confirm the next command exists and works. Human presentation changes must not corrupt machine output, exit status or process cleanup. Automated checks must not launch real app/device/browser surfaces or shared services unless separately authorized.

Save command, runtime, tested revision or input fingerprint, exit status, signal/timeout and relevant output. Reuse valid evidence; run required integration checks on the final integrated change. Keep unexpected failures and their explanations, and use the user-owned debugging protocol when investigating them. Finish when the named requirements pass.

## References

- [Command Line Interface Guidelines](https://clig.dev/): consult relevant output, errors, interactivity, robustness and distribution sections when making those decisions.
- [Upstream CLI Patterns source](https://github.com/0xDarkMatter/claude-mods/blob/fa93328d128d0b4d5f38e6bac7613e7bcc824454/skills/cli-ops/SKILL.md), pinned at `fa93328d128d0b4d5f38e6bac7613e7bcc824454`.
- [Upstream MIT notice](cli-design.LICENSE). The upstream text and this adaptation are provided under that notice; no licensing decision for the Traverse product is implied.
