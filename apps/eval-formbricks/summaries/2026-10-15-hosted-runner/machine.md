# The machine

The [Formbricks eval workflow](../../../../.github/workflows/eval-formbricks.yml), [run 38807109802](https://github.com/ayme-labs/ayme/actions/runs/38807109802), started by hand on 2026-10-15 on `main` at [`1f300f8f`](https://github.com/ayme-labs/ayme/commit/1f300f8f0a2188b07027532217c34c9e9b944492), with three runs per arm. A hosted runner's timings are not comparable with a Mac's.

| OS                 | Runner image                | CPUs | Memory | Chrome        | Docker |
| ------------------ | --------------------------- | ---- | ------ | ------------- | ------ |
| Ubuntu 24.04.5 LTS | ubuntu-24.04 20261012.334.1 | 4    | 16 GB  | 155.0.8059.39 | 28.0.4 |

CPUs and memory are GitHub's figures for its standard Linux runner in a public repository; the rest is from the run's log. The lab app answered 247 s after `lab:dev` started. The Goal Loop made 34 decision calls, none failed. OpenRouter still has no record of two of one run's four calls, so that run's combined cost is unknown; the other 30 calls cost $0.0070. In one Playwright CLI run the agent saved a snapshot file into the lab app folder; the run moved it out and still passed. The stored runs, with their transcripts, are in the run's `eval-formbricks-results` artifact until 2027-01-13.
