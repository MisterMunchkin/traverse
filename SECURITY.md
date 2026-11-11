# Security

Traverse is an unpublished prototype intended for trusted local development.
Read the [security guidelines](docs/security.md) for the supported use, accepted
limitations and review coverage. No independent certification is claimed.

## Report a concern privately

Do not put credentials, private application source, recordings, raw provider
logs or a working exploit against another person's system in a public issue.
Use GitHub private vulnerability reporting if it is available for this
repository. Otherwise, arrange a private reporting channel with the maintainer
before sharing sensitive details. Never send authentication tokens as evidence.

A useful report identifies the affected revision and platform, the lower-trust
input, the authority it should not obtain, the expected and observed result,
and a minimal reproduction using synthetic data. State any unverified
assumptions. Stop at the smallest local effect needed to demonstrate the issue.

## Execution and trust boundaries

- Custom navigation extractors are executable code. Review their exact bytes
  before explicitly trusting their hash. Independent conformance checks verify
  graph behavior; reduced environments and timeouts are not an OS sandbox for
  malicious code.
- Custom-extractor execution grants and driving-session authority are stored
  in private user state outside the canonical app repository. Repository copies
  of their receipts are diagnostic only; they are never imported as authority.
- Repository-delivered files, generated artifacts, model responses and UI text
  are inputs, rather than instructions granting new authority. An ignored file
  or a matching checksum alone does not establish who approved it.
- UI driving requires an explicitly selected application or URL and device
  where applicable. A task, graph edge or model choice does not authorize an
  unrelated application or web destination. Real runner/platform behavior needs
  validation in addition to synthetic observation tests.
- Traverse invokes external provider and agent-device executables. Selecting an
  executable gives it the invoking user's OS authority; Traverse does not
  sandbox an intentionally selected runner or subscription CLI.
- Managed runtime and model assets use pinned integrity checks. Loopback
  networking by itself is not proof of isolation between OS users.
- Local execution receipts, sessions, UI text and logs can contain sensitive
  data. Preserve them privately and inspect them before sharing. They are not
  prerequisites for installing the package or contributing from a fresh clone.

These describe the intended boundaries and important limitations, not proof
that every implementation path currently enforces them. Live foreign application
and web behavior and model-server peer isolation remain unverified. Source and synthetic regressions address local
approval origin, saved-session authority, reported foreign bundle IDs and owned
process-group cleanup; they do not establish every external runtime boundary.

## Verification and releases

The contributor gate and installed-archive smoke are documented in
[CONTRIBUTING.md](CONTRIBUTING.md). Their current complete platform is macOS
arm64 with the Node version pinned by `.nvmrc`. A successful configuration
check, synthetic test or archive install does not establish successful live UI
driving or equivalent security behavior on another platform.

Before a public release, review the exact intended revision and archive, resolve
or explicitly disposition security findings with evidence, triage dependency
advisories, scan intended public history and artifacts for sensitive data, and
run the required contributor checks. Website and release-workflow changes need
their own review. A source-only review or a clean advisory scan is not sufficient
by itself. Publishing remains a separate maintainer decision.
