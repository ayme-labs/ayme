# Page Object study: baselines

The "before" of the Page Object study (the [fixture's README](../../README.md)): each arm's suite on the Inspector before the redesign. Each cell is the range over the arm's runs; each run's totals and exceptions are in `<arm>.json`.

The suite: 74 test runs that every arm has, and 13 more of arm 2's own, 87 in arm 2.

## Measuring an arm

```sh
pnpm study:baseline arm1
pnpm study:baseline arm2
pnpm study:baseline arm3
pnpm study:baseline render   # this page again, from the arms' files
```

Run it from `apps/inspector-fixture` in the repository's Devbox shell, on your own machine, from a committed tree, one arm at a time with nothing else running. The goal arms replay the recordings committed under `.e2e/goals-cache` and `.e2e/goals-tools-cache` read-only; a step that does not replay goes to Claude Code on the machine's own login, so it must be signed in, and the `ayme mcp` port the arm's recordings were made on must be free ([e2e.goals.config.ts](../../e2e.goals.config.ts), [e2e.goals-tools.config.ts](../../e2e.goals-tools.config.ts)). It builds the packages the fixture serves, warms one fixture server, runs the arm's own script three times on it, and saves the arm's file only when all three runs completed on one commit with the same recordings. Each run's full e2e report stays on the machine that ran it, at `.e2e/study/<arm>/<time>/run-<n>/report.json`, and is not published. [The script](../../scripts/study-baseline.mjs) holds each guard's reason.

## The tests every arm has

| Arm                                 | Tests passed | Summed test time | Goal steps | Replayed, no model call | Reached the model (failed) | Neither | Not replayed (distinct goals) | Tokens | e2e's cost estimate |
| ----------------------------------- | ------------ | ---------------- | ---------- | ----------------------- | -------------------------- | ------- | ----------------------------- | ------ | ------------------- |
| Arm 1: plain goals                  | 74 of 74     | 322 s–326 s      | 241        | 241                     | 0 (0)                      | 0       | 0 (0)                         | 0      | $0.00               |
| Arm 2: Page Objects                 | 74 of 74     | 272 s–278 s      | none       | none                    | none                       | none    | none                          | none   | none                |
| Arm 3: goals with Page Object Tools | 74 of 74     | 310 s–317 s      | 241        | 241                     | 0 (0)                      | 0       | 0 (0)                         | 0      | $0.00               |

- Reached the model: a goal step e2e's step metrics count a model call for, whatever its outcome; in brackets those whose step failed. Neither: a goal step that did not replay and called no model, such as one that failed before a call.
- Tokens are the provider's input plus output, prompt-cache reads and writes included. They are unknown for a run in which a step that reached the model has no provider count (e2e marks such a record `adapter-upper-bound`). e2e's cost estimate is its own; $0.00 where no step called a model.
- Not replayed: the goal steps of these runs that did not replay with no model call, and in brackets the distinct goals among them, a goal's text with its parameters counted once however many tests ran it.
- Every arm ran with one worker and no retries, so this is a serial comparison. The default test timeout is 30 s in arm 2 and 900 s in the goal arms ([e2e.config.ts](../../e2e.config.ts), [e2e.goals.config.ts](../../e2e.goals.config.ts)).

## Arm 2's other tests

The tests with no action to turn into a goal (`LEFT_OUT` in [the mirror check](../../scripts/check-goal-mirror.mjs)).

| Arm                 | Tests passed | Summed test time |
| ------------------- | ------------ | ---------------- |
| Arm 2: Page Objects | 13 of 13     | 59 s–60 s        |

## Whole runs

Command time is the arm's script from start to exit, every test of the arm included. The load average is the machine's 1-minute load as each run started.

| Arm                                 | Command time | Load average | Commit      | Recordings                                                |
| ----------------------------------- | ------------ | ------------ | ----------- | --------------------------------------------------------- |
| Arm 1: plain goals                  | 324 s–328 s  | 5.6–43.5     | `57d5ffc6f` | `.e2e/goals-cache`, 241 entries, digest `df08f6150`       |
| Arm 2: Page Objects                 | 333 s–340 s  | 5.3–12.8     | `57d5ffc6f` | none                                                      |
| Arm 3: goals with Page Object Tools | 317 s–325 s  | 5.6–12.1     | `57d5ffc6f` | `.e2e/goals-tools-cache`, 241 entries, digest `28749b916` |

## Goal steps that did not replay

By test and line: e2e's cache outcome and reason (`no-entry`: the recordings hold none for the step; e2e records nothing for a step that changed no control and no route, `no-change` in [When a recording is written](https://e2e.com/docs/cache#when-a-recording-is-written)), the step's outcome, and the runs it was in with their usage.

Arm 1: plain goals:

- none

Arm 3: goals with Page Object Tools:

- none

## Tests that did not pass

None.
