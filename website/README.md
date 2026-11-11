# Traverse website and downloads

Dependency-free static website. No analytics, external fonts or CDN scripts.
Graph illustration and command copying enhance a no-JavaScript reading path.

```sh
npm run check:site
npm run site:build
npm run site:preview
```

Build output is `.checks/site/dist/`; preview binds only to `127.0.0.1:4173`.
`PORT` selects a loopback port. Stop with Ctrl-C. The preview serves only its
explicit asset/download allowlist, not source, local receipts or dependencies.
Only the default marked output can be replaced; custom `--out` must be fresh.

A build packages a candidate TGZ, checksum and identity manifest from the current
source. To reuse exactly an already prepared bundle, pass
`--release-dir .checks/candidate` to `site:build`; the archive bytes are copied.
Tagged bundles say experimental release; ordinary PR/local builds say candidate.
The rendered security page is generated from `docs/security.md` and is available
without private GitHub access. Other repository guide links require repo access
until the source is public. Node/npm are required for archive installation;
there is no `curl | sh` installer. See [release preparation](../docs/releasing.md).

Netlify Deploy Previews build the PR source; production contexts remain refused.
No model assets are in the static output. Website QA does not validate Traverse's
live model/device driving. Before publishing a preview, inspect the exact packed
paths, checksum, source identity and download/install result. A checksum served
beside its archive detects mismatch but is not a publisher signature.

Browser visual/responsive, copy/keyboard and recording acceptance need an
available authorized browser. HTTP/build checks alone do not establish them.
