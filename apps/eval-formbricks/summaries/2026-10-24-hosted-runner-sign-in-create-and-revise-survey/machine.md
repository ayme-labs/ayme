# The machine

The [Formbricks eval workflow](../../../../.github/workflows/eval-formbricks.yml), [run 40072190795](https://github.com/ayme-labs/ayme/actions/runs/40072190795), started by hand on 2026-10-24 on [`8a9aad6`](https://github.com/ayme-labs/ayme/commit/8a9aad63476f3acd97517358b7f22fde8394d21e), with ten runs per arm. A hosted runner's timings are not comparable with a Mac's.

| OS                 | Runner image            | CPUs | Memory | Chrome        | Docker |
| ------------------ | ----------------------- | ---- | ------ | ------------- | ------ |
| Ubuntu 24.04.5 LTS | ubuntu24 20261023.334.3 | 4    | 16 GB  | 155.0.8059.39 | 28.0.4 |

CPUs and memory are GitHub's figures for its standard Linux runner in a public repository; the rest is from the run's log. The lab app answered 245 s after `lab:dev` started. The Goal Loop made 360 decision calls, none failed, and every call has a cost record from OpenRouter. In three runs the agent saved files into the lab app folder; each run moved them out and still passed. The stored runs, with their transcripts, are in the run's `eval-formbricks-results` artifact.
