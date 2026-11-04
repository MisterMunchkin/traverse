# Traverse project website

Repository-only static implementation. No hosting, release workflow, analytics, external fonts, CDN scripts or public download endpoints. Only `index.html`, `styles.css`, `site.js` and `mark.svg` are built. The site works without JavaScript; route exploration and command copying are enhancements. All repository guide links require access to the private repository.

From the repository root, using Node (no dependency install required for the site):

```sh
npm run check:site
npm run site:build
npm run site:preview
```

Preview binds only to `127.0.0.1:4173`. `PORT` selects another loopback port. Stop with Ctrl-C. Build output is ignored at `.checks/site/dist/`. This is a copy build with relative assets; the four output files can be served at a root or a subdirectory by a future approved static host. The preview serves only those four files, not source, evidence or repository contents. It does not deploy anything.

## Content maintenance

The source of truth is the root README and `docs/adoption.md`, `docs/adapters.md`, `docs/project-setup.md`, `docs/driving.md` and `docs/maintaining.md`. Recheck CLI version, archive name, platform requirements and coverage when those change. The map is an illustration, not a running extractor or live app. Avoid widening framework/platform claims from fixtures. Keep model download/setup separate from extraction. npm-free installation is a future direction; current `install.sh` requires the checkout and Node.

`npm run check:site` validates local assets, unique IDs, internal anchors, and repository documentation paths/headings without calling GitHub. It is included in the full contributor gate. Browser QA is deliberately separate from the product's live driving validation.

## Browser QA

With the preview running, use the repository-only QA script if Python Playwright and Chromium are available:

```sh
python website/qa.py
```

This uses `/usr/bin/chromium` by default; set `CHROMIUM_PATH` for another installed Chromium. It verifies responsive overflow at 320, 390, 768, 1024 and 1440 pixels, internal navigation, keyboard focus and graph interactions, disclosure controls, clipboard copying, reduced-motion behavior and a no-JavaScript reading path. It saves PNGs and a JSON receipt under `.checks/site/browser/`. No browser dependency is added to the runtime or contributor gate. See [evidence](evidence/README.md) for the captured preview and actual checks/limits of this implementation.
