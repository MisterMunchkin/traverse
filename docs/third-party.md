# Third-party components and licensing

The [MIT license](../LICENSE) covers Traverse's original code and documentation. It does not replace licenses, copyright notices or service terms supplied with other components.

## Installed npm dependency

**TypeScript 6.0.3** is pinned by `npm-shrinkwrap.json` and installed by npm under **Apache-2.0**. Its distributed package contains `LICENSE.txt` and `ThirdPartyNoticeText.txt`; preserve those files when redistributing it. TypeScript is a dependency, not vendored into Traverse's tarball. See the [versioned TypeScript license](https://github.com/microsoft/TypeScript/blob/v6.0.3/LICENSE.txt) and the actual notices in the installed dependency for authoritative version-specific text.

## Optional downloaded runtime and model

Machine setup downloads these separately, verifies pinned content and stores it in a user-owned cache. Neither runtime binaries nor model weights are bundled in the Traverse npm archive.

- **Ollama 0.40.8:** its top-level source [license](https://github.com/ollama/ollama/blob/v0.40.8/LICENSE) is MIT, copyright Ollama. Runtime distributions can include other components and their notices; preserve the notices accompanying those assets. Traverse's license does not replace them.
- **`tev1:4b-q8_0`:** the pinned manifest digest is `7954dce22bc6c29c3b119656207681d12cb34434fed7caa086bfbc919bef0740`. The [official model tag](https://ollama.com/library/tev1:4b-q8_0) lists Apache-2.0 and an MIT notice for open-jev contributors. Consult the licenses carried by the exact model manifest and its upstream sources before redistributing weights. These assets are not relicensed as Traverse code.

## Separately installed tools and providers

`agent-device`, Node.js, Codex and Claude are independently installed tools or services. They retain their own licenses, access requirements and terms. Selecting a provider in Traverse does not grant access to that provider or include a subscription. Traverse does not bundle their executables.

## Example and research material

The source-only Expo example retains its existing MIT notice at `examples/expo/LICENSE`, copyright 650 Industries, Inc. (aka Expo). That example and its notice are available in the source checkout and are not part of the CLI archive. Expo and the example's other dependencies retain their own notices.

The research summary describes earlier experiments and includes selected aggregate numbers. It grants no rights to third-party app code, provider outputs, model weights or recordings. Raw prompts, app-source excerpts and recordings are not included in this package.


## Contributor CLI guidance

The [Node CLI design guide](contributing/cli-design.md) adapts the CLI Patterns guidance from [0xDarkMatter/claude-mods](https://github.com/0xDarkMatter/claude-mods/blob/fa93328d128d0b4d5f38e6bac7613e7bcc824454/skills/cli-ops/SKILL.md), pinned to that revision. Its original [MIT notice](contributing/cli-design.LICENSE), copyright 2025–2026 0xDarkMatter, is included. The adaptation preserves Traverse's Node implementation and existing contracts; upstream Python choices are not required.
