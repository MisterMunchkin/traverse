# Security guidelines

Traverse is an experimental developer tool intended for trusted local projects
on a trusted personal computer. Use synthetic accounts and test data when
trying UI driving. It is not a sandbox for malicious repositories, custom
extractors, websites, models or selected executables.

## Local model access

The managed Ollama runtime binds to IPv4 loopback (`127.0.0.1`), rather than a
LAN-facing address. Its local API is unauthenticated: loopback does not isolate
it from other local processes or users able to reach that listener. The owned
process lifecycle and asset checksums do not provide peer authentication.
Use a trusted machine; do not expose or forward its ports. Shared machines and
environments running untrusted workloads need additional, separately verified
isolation. Never treat a random port as a credential.

## Browser and device driving

Choose the app, URL and device explicitly. Start with a disposable development
session and synthetic inputs. The web runner does not currently enforce an
origin allowlist or bind actions to an authoritative document/frame identity.
A redirect or embedded page can cross the intended website boundary, and a
fresh snapshot with matching controls does not prove which website owns them.
Avoid untrusted destinations and sensitive inputs, including real credentials,
payment details and private production data. An external login or other
destination needs its own explicit user authorization; model output is not
authorization.

Native reported-application checks and fresh-control checks reduce some target
mistakes. They do not establish comprehensive platform isolation. Packaged live
browser/native tasks, durable effects and recording playback still need
end-to-end validation; see [validation coverage](driving.md#validation-coverage).

## Code, providers and evidence

Review custom extractor bytes before approving their exact hash. Selected
runner/provider executables run with your OS authority. A reduced environment,
timeout or successful conformance test does not make hostile code safe.

Frontier escalation can send task inputs, source graph information and observed
UI text to the selected provider. Choose inputs accordingly. Receipts, entered
values, snapshots and recordings can contain sensitive information: keep local
state private and review evidence before sharing it. Do not commit credentials,
model caches or raw session artifacts.

## Review status

The November 2026 security review led to fixes for local extractor approval,
saved-session authority, reported foreign application IDs and owned-process
cleanup. Local synthetic regressions and contributor/archive checks were used;
hostile exploit, cross-user and live service/device/model probes were excluded
from this remediation. No independent certification is claimed.

Unauthenticated local model access and the missing web origin/document boundary
are accepted limitations for trusted local testing, not repaired isolation
mechanisms. Contributor Netlify CLI and Expo sample dependency advisories remain
open after triage; they are distinct from the shipped CLI runtime dependency
tree. No claim of zero vulnerable dependencies or production readiness is made.

Report concerns privately using the repository's security policy. Keep reports
minimal and use synthetic data rather than credentials or private recordings.
