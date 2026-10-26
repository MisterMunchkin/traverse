# Traverse

Give UI agents a navigation map and a small local model for routine decisions. Traverse extracts reviewed source graphs, uses **tev1** for local choices, and escalates uncertain decisions to **Codex or Claude**. Its built-in UI runner uses **agent-device**.

**Prototype:** Expo Router extraction is supported. Packaged native driving still needs end-to-end validation.

## Install

Requires Node **22.11+**. The npm package is not published yet; build from this repository:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm pack
npm install --global ./mistermunchkin-traverse-0.12.0.tgz
```

Optionally install the local model once per machine:

```sh
traverse setup
```

Managed model setup currently supports macOS arm64 and downloads several GB. Graph extraction needs no model.

## Set up a project

Inside a supported Expo project:

```sh
traverse init
traverse doctor
traverse graph watch
```

The interactive wizard selects provider, model, effort and run limits. It can also install a shared agent skill. Settings and the graph live in `.wayfinder/`; watch refreshes the graph as source changes.

The graph describes declared navigation. It does not prove which controls are visible or whether an action changed app data.

For a ready-made project, try the [Expo example](examples/expo/README.md).

## Results

A browser-fixture study compared the **same Sol 6.1 model at medium effort**, alone and with tev1. Twelve tasks ran twice per arm: **48 attempts**, including failures.

| Measurement | Sol alone | Sol + tev1 |
| --- | ---: | ---: |
| Completed attempts | 23/24 | 24/24 |
| Driving time, 23 common completions | 567.64 s | 318.43 s |
| Frontier requests, all attempts | 84 | 10 |
| Frontier input tokens, all attempts | 1,206,982 | 143,528 |

Assistance used **43.9% less matched driving time** and **88.1% fewer frontier input tokens**. Driving time excludes startup/preparation. The control's startup timeout stays counted; it does not establish a reliability advantage. Dollar charges and local compute costs were not measured, and large frontier context contributed to token savings.

Earlier experiments also found failures: assistance sometimes lost to the control, high confidence did not guarantee safe choices, and extra graph structure did not consistently help. These are small fixture studies, not production or native-app guarantees.

[Methods, negative results and limitations](docs/research.md) · [Aggregate results](docs/research/results.json)

## Guides

- [Installation, graph format and compatibility](docs/adoption.md)
- [Project settings and agent integration](docs/project-setup.md)
- [Routing adapters](docs/adapters.md)
- [UI driving and recordings](docs/driving.md)

For development, run `npm test`. See `traverse --help` for commands.

## License

[MIT](LICENSE), copyright 2026 Traverse contributors. [Third-party components](docs/third-party.md) retain their own terms.
