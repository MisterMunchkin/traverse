# Preparing an experimental release

Keep `private: true` for TGZ/GitHub distribution. This prevents accidental npm
registry publication without preventing archive installation. Choose a version
and matching `vVERSION` Git tag; package and shrinkwrap versions must agree.
Release notes for the first candidate are in [0.12.0](releases/0.12.0.md).

## Review a candidate locally

After both locked contributor installs, run the full gate from
[CONTRIBUTING.md](../CONTRIBUTING.md). Then prepare a fresh candidate bundle:

```sh
npm run release:pack -- --out .checks/candidate
npm run release:verify -- --out .checks/candidate
npm run check:package -- --out .checks/candidate-install --archive .checks/candidate/mistermunchkin-traverse-0.12.0.tgz
npm run site:build -- --release-dir .checks/candidate
npm run site:preview
```

Outputs are the TGZ, `SHA256SUMS` and `release.json`. The manifest identifies
archive bytes, packed source files and, where available, Git revision and dirty
state. An uncommitted candidate is not attributed to a clean release commit.
The archive smoke refuses an archive whose bytes differ from a fresh pack of
the current source, and installs into a disposable dev dependency with source
reads/network denied during CLI verification. It changes no global install.

The website copies the supplied verified bundle without repacking it. Without
`--release-dir`, it packs a candidate from that checkout. Downloads are relative
to the website at `downloads/`; the HTML instructions and links work without
JavaScript. Use HTTPS and an independently trusted source; a checksum beside a
download is not a signature. Model acquisition remains a separate command.

## GitHub automation

After explicit maintainer approval, commit/review the final source, create its
matching version tag and publish a GitHub release (use the prerelease flag for
this experimental version). The release workflow handles `release: published`,
including published prereleases. It checks identity/version, runs the full
macOS contributor gate, packs a clean exact-tag checkout and tests those exact
archive bytes before attaching the TGZ/checksums/manifest to that release.
It does not create tags/releases, publish to npm, change repository visibility,
deploy production or acquire model weights. Reruns refuse existing asset names
rather than silently replacing a published download. Investigate partial
uploads before retrying; do not overwrite already-installed bytes under a tag.

The build job has read-only repository access. Only the separate attachment
job has contents-write permission; it downloads the current run's artifact
and uses GitHub's job token. No personal access token or Netlify secret is needed.

## Website preview and public launch

Netlify's approved Deploy Preview builds the PR source with
`node scripts/site.mjs build` and publishes `.checks/site/dist`. The candidate
TGZ, checksum, build identity and security guidance are included in that same
preview. Download and verify it, then test that downloaded TGZ as a dev
dependency. This tests the distribution path, not live model/device behavior.

After the approved public launch, `netlify.toml` enables the production website
from `main` with `node scripts/site.mjs build --allow-production`. Production
builds without that explicit flag remain refused. Deploy Previews use the
default build command. Hosted candidates stay labelled as candidates; a website
deployment does not create a version tag or GitHub release. Repository visibility,
npm registry publication and website deployment remain separate maintainer actions.
A public website can serve candidate TGZ bytes from a private repository, so
only deploy the intended reviewed package payload. Never copy credentials,
local receipts or generated caches into the static output.
