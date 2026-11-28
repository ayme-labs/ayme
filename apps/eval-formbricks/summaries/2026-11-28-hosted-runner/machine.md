# The machine

The [Formbricks eval workflow](../../../../.github/workflows/eval-formbricks.yml), started by hand on [`482bad2`](https://github.com/ayme-labs/ayme/commit/482bad2baf85550acd54af8eb6bd2bc997dfc234), the head of the pull request that adds the `ayme` command, in [run 46148770571](https://github.com/ayme-labs/ayme/actions/runs/46148770571) on 2026-11-28: ten runs per arm in one suite. A hosted runner's timings are not comparable with a Mac's.

| OS                 | Runner image          | CPUs | Memory |
| ------------------ | --------------------- | ---- | ------ |
| Ubuntu 26.04.1 LTS | ubuntu26 20261122.9.1 | 4    | 15 GiB |

The figures are from the run's job summary. The four `agent-browser` runs that did not pass ended when Claude Code refused a shell command the arm's permission rules do not allow, before the agent changed anything: they say nothing about agent-browser itself. The stored runs, with their transcripts, are in the run's `eval-formbricks-results` artifact.
