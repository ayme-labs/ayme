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

Run it from `apps/inspector-fixture` in the repository's Devbox shell, on your own machine, from a committed tree, one arm at a time with nothing else running. The goal arms replay the recordings committed under `.e2e/goals-cache` and `.e2e/goals-tools-cache` read-only; a step that does not replay goes to Claude Code on the machine's own login, so it must be signed in, and the `ayme mcp` port the arm's recordings were made on must be free (`e2e.goals.config.ts`, `e2e.goals-tools.config.ts`). It builds the packages the fixture serves, warms one fixture server, runs the arm's own script three times on it, and saves the arm's file only when all three runs completed on one commit with the same recordings. Each run's full e2e report stays on the machine that ran it, at `.e2e/study/<arm>/<time>/run-<n>/report.json`, and is not published. [The script](../../scripts/study-baseline.mjs) holds each guard's reason.

## The tests every arm has

| Arm                                 | Tests passed | Summed test time | Goal steps | Replayed, no model call | Model answered | Unaccounted | Not replayed (distinct goals) | Tokens | e2e's cost estimate |
| ----------------------------------- | ------------ | ---------------- | ---------- | ----------------------- | -------------- | ----------- | ----------------------------- | ------ | ------------------- |
| Arm 1: plain goals                  | 74 of 74     | 322 s–326 s      | 241        | 241                     | 0              | 0           | 0 (0)                         | 0      | $0.00               |
| Arm 2: Page Objects                 | 74 of 74     | 272 s–278 s      | none       | none                    | none           | none        | none                          | none   | none                |
| Arm 3: goals with Page Object Tools | 74 of 74     | 310 s–317 s      | 241        | 241                     | 0              | 0           | 0 (0)                         | 0      | $0.00               |

- Tokens are input plus output, prompt-cache reads and writes included. e2e's cost estimate is its own, from the same usage.
- Unaccounted: a goal step that neither replayed nor passed with the model, so its usage cannot be told.
- Not replayed: the goal steps that did not replay with no model call, and in brackets the distinct goals among them, a goal's text with its parameters counted once however many tests run it: the count a recording per goal, shared by every test, would have left.
- Every arm ran with one worker and no retries, so this is a serial comparison. The default test timeout is 30 s in arm 2 and 900 s in the goal arms ([e2e.config.ts](../../e2e.config.ts), [e2e.goals.config.ts](../../e2e.goals.config.ts)).

## Arm 2's other tests

The tests with no action to turn into a goal (`LEFT_OUT` in [the mirror check](../../scripts/check-goal-mirror.mjs)).

| Arm                 | Tests passed | Summed test time |
| ------------------- | ------------ | ---------------- |
| Arm 2: Page Objects | 13 of 13     | 59 s–60 s        |

## Whole runs

Command wall time is the arm's script from start to exit, every test of the arm included. The load average is the machine's 1-minute load as each run started.

| Arm                                 | Command wall time | Load average | Commit      | Recordings                                                |
| ----------------------------------- | ----------------- | ------------ | ----------- | --------------------------------------------------------- |
| Arm 1: plain goals                  | 324 s–328 s       | 5.6–43.5     | `57d5ffc6f` | `.e2e/goals-cache`, 241 entries, digest `df08f6150`       |
| Arm 2: Page Objects                 | 333 s–340 s       | 5.3–12.8     | `57d5ffc6f` | none                                                      |
| Arm 3: goals with Page Object Tools | 317 s–325 s       | 5.6–12.1     | `57d5ffc6f` | `.e2e/goals-tools-cache`, 241 entries, digest `28749b916` |

## Goal steps with no recording

Steps the committed recordings hold no entry for in every run (e2e's `no-entry`), so they reach the model each time; they count as model answered above. e2e as published records nothing for a step that changed no control and no route on the tab it reads (`no-change` in [When a recording is written](https://e2e.com/docs/cache#when-a-recording-is-written)).

Arm 1: plain goals:

- none

Arm 3: goals with Page Object Tools:

- none

## Goal steps not replayed

The other goal steps that did not replay, by test and line, with e2e's reason, the runs each was in and its usage there.

Arm 1: plain goals:

- none

Arm 3: goals with Page Object Tools:

- none

## Tests that did not pass

None.
