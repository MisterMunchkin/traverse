# Wayfinder Expo sample

Use the repository guidance. This deliberately uses root `app/` and `@/*` → `./*` for the existing extractor contract. Keep helpers in `components/` and sample snapshot tooling in `scripts/`. Use the installed Expo SDK version and pinned official docs; consult Expo UI first.

Run npm run typecheck, npm run lint, npm test and npm run export:web. Automated checks must not launch browsers/devices or contact shared services. Keep installation outputs under ignored `.wayfinder/` or disposable owned prefixes. Do not add a nested Git repository, backend, EAS identity or native probe.
<!-- BEGIN Wayfinder agent guidance -->
Use Traverse for navigation-graph maintenance and UI driving in this repository.
Read `.agents/skills/traverse/SKILL.md` before using it; follow this repository's task and permission instructions.
<!-- Wayfinder guidance sha256:9b15768e15d2b4c1e610171d5fcba2b4d8534c7702b061e10e7c879d0bda6cf6 -->
<!-- END Wayfinder agent guidance -->
