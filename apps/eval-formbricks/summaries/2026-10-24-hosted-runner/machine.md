# The machine

The [Formbricks eval workflow](../../../../.github/workflows/eval-formbricks.yml), started by hand on [`8a9aad6`](https://github.com/ayme-labs/ayme/commit/8a9aad63476f3acd97517358b7f22fde8394d21e), in two runs: [run 39967703086](https://github.com/ayme-labs/ayme/actions/runs/39967703086) on 2026-10-23 stored four good runs per arm before the shared Claude Code usage limit stopped it, and [run 40072188919](https://github.com/ayme-labs/ayme/actions/runs/40072188919) on 2026-10-24 added six. This summary is built from one suite manifest that lists both runs' stored runs, ten per arm. It leaves out the run the usage limit cut short. A hosted runner's timings are not comparable with a Mac's.

| OS                 | Runner image            | CPUs | Memory | Chrome        | Docker |
| ------------------ | ----------------------- | ---- | ------ | ------------- | ------ |
| Ubuntu 24.04.5 LTS | ubuntu24 20261023.334.3 | 4    | 16 GB  | 155.0.8059.39 | 28.0.4 |

CPUs and memory are GitHub's figures for its standard Linux runner in a public repository; the rest is from the 2026-10-24 run's log. Every Goal Loop call has a cost record from OpenRouter. In seven runs the agent saved files into the lab app folder; each run moved them out and still passed. The stored runs, with their transcripts, are in each run's `eval-formbricks-results` artifact.
