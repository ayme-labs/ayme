# The machine

The [Formbricks eval workflow](../../../../.github/workflows/eval-formbricks.yml), [run 37512094518](https://github.com/ayme-labs/ayme/actions/runs/37512094518), started by hand on 2026-10-06 with one run per arm. A shake-out of the workflow, not a measurement: one run per arm gives no spread, and a hosted runner's timings are not comparable with a Mac's.

| OS                 | Runner image                | CPUs | Memory | Chrome        | Docker |
| ------------------ | --------------------------- | ---- | ------ | ------------- | ------ |
| Ubuntu 24.04.5 LTS | ubuntu-24.04 20260927.320.1 | 4    | 16 GB  | 154.0.8037.57 | 28.0.4 |

CPUs and memory are GitHub's figures for its standard Linux runner in a public repository; the rest is from the run's log. The lab app answered 243 s after `lab:dev` started. The Goal Loop made 6 decision calls, none failed, for $0.0014. The stored runs, with their transcripts and `summary.json`, are in the run's `eval-formbricks-results` artifact until 2027-01-04.
