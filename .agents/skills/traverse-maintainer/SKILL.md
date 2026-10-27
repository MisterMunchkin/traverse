---
name: traverse-maintainer
description: "Maintain Traverse itself: its CLI, source graphs, reviewed adapters, model setup, driving contracts, tests, documentation and packaging. Use in the Traverse source repository; for driving a consuming app, use that app's Traverse skill instead."
---

# Traverse maintainer

Start with the repository's [AGENTS.md](../../../AGENTS.md) and [maintainer handbook](../../../docs/maintaining.md). They are the maintained instructions; no global skills, experiment checkout or previous conversation is required.

- For setup and verification, follow [CONTRIBUTING.md](../../../CONTRIBUTING.md). Use its two sequential locked installs. The complete gate is `npm run check`; preserve its reports and distinguish configuration checks from live UI/model validation.
- Use the handbook's source map to find the existing implementation before adding a helper. Read the [CLI design guide](../../../docs/contributing/cli-design.md) for command, output or lifecycle changes.
- Preserve exact-code adapter review, independent conformance, static configuration inspection, source fingerprints, fresh UI targets and owned-process cleanup. The handbook explains these boundaries and where they are enforced.
- For dependency/model pins, format changes or distribution, follow the handbook's update and release sections. Keep compatibility and validation limits explicit. A green check is not permission to push, publish, install globally or run a live app/model task.

The consumer skill template is `src/skills/traverse.md`; it is installed into initialized app repositories. Do not initialize the Traverse source root as an app or replace this maintainer skill with generated consumer guidance.
