# Page Object study: baselines

The "before" of the Page Object study (the [fixture's README](../../README.md)): each arm's suite on the Inspector before the redesign. Each cell is the range over the arm's runs; each run's totals and exceptions are in `<arm>.json`.

The suite: 72 test runs that every arm has, and 13 more of arm 2's own, 85 in arm 2.

## Measuring an arm

```sh
pnpm study:baseline arm1
pnpm study:baseline arm2
pnpm study:baseline arm3
pnpm study:baseline render   # this page again, from the arms' files
```

Run it from `apps/inspector-fixture` in the repository's Devbox shell, on your own machine, from a committed tree, one arm at a time with nothing else running. The goal arms replay the recordings committed under `.e2e/goals-cache` and `.e2e/goals-tools-cache` read-only; a step that does not replay goes to Claude Code on the machine's own login, so it must be signed in, and the `ayme mcp` port the arm's recordings were made on must be free (`e2e.goals.config.ts`, `e2e.goals-tools.config.ts`). It builds the packages the fixture serves, warms one fixture server, runs the arm's own script three times on it, and saves the arm's file only when all three runs completed on one commit with the same recordings. Each run's full e2e report stays on the machine that ran it, at `.e2e/study/<arm>/<time>/run-<n>/report.json`, and is not published. [The script](../../scripts/study-baseline.mjs) holds each guard's reason.

## The tests every arm has

| Arm                                 | Tests passed | Summed test time | Goal steps | Replayed, no model call | Model answered | Unaccounted | Not replayed (distinct goals) | Tokens         | e2e's cost estimate |
| ----------------------------------- | ------------ | ---------------- | ---------- | ----------------------- | -------------- | ----------- | ----------------------------- | -------------- | ------------------- |
| Arm 1: plain goals                  | 72 of 72     | 324 s–338 s      | 242        | 240                     | 2              | 0           | 2 (2)                         | 96,023–113,596 | $0.07–$0.08         |
| Arm 2: Page Objects                 | 72 of 72     | 265 s–270 s      | none       | none                    | none           | none        | none                          | none           | none                |
| Arm 3: goals with Page Object Tools | 72 of 72     | 299 s–307 s      | 242        | 242                     | 0              | 0           | 0 (0)                         | 0              | $0.00               |

- Tokens are input plus output, prompt-cache reads and writes included; cache reads are 84%–86% of them. e2e's cost estimate is its own, from the same usage.
- Unaccounted: a goal step that neither replayed nor passed with the model, so its usage cannot be told.
- Not replayed: the goal steps that did not replay with no model call, and in brackets the distinct goals among them, a goal's text with its parameters counted once however many tests run it: the count a recording per goal, shared by every test, would have left.
- Every arm ran with one worker and no retries, so this is a serial comparison. The default test timeout is 30 s in arm 2 and 900 s in the goal arms ([e2e.config.ts](../../e2e.config.ts), [e2e.goals.config.ts](../../e2e.goals.config.ts)).

- Arm 1: plain goals: steps with no recording (missed, no-entry) used 96,182, 113,596, 96,023 tokens in its 3 runs, 100% of its tokens. An attribution within these runs, not an estimate of a run without those steps: they shared an agent session with the arm's other steps.

## Arm 2's other tests

The tests with no action to turn into a goal (`LEFT_OUT` in [the mirror check](../../scripts/check-goal-mirror.mjs)).

| Arm                 | Tests passed | Summed test time |
| ------------------- | ------------ | ---------------- |
| Arm 2: Page Objects | 13 of 13     | 59 s–61 s        |

## Whole runs

Command wall time is the arm's script from start to exit, every test of the arm included. The load average is the machine's 1-minute load as each run started.

| Arm                                 | Command wall time | Load average | Commit      | Recordings                                                |
| ----------------------------------- | ----------------- | ------------ | ----------- | --------------------------------------------------------- |
| Arm 1: plain goals                  | 326 s–340 s       | 5.0–8.1      | `b30f0b11d` | `.e2e/goals-cache`, 240 entries, digest `ae2b2aed0`       |
| Arm 2: Page Objects                 | 327 s–333 s       | 4.7–44.4     | `b30f0b11d` | none                                                      |
| Arm 3: goals with Page Object Tools | 306 s–316 s       | 8.3–12.0     | `b30f0b11d` | `.e2e/goals-tools-cache`, 242 entries, digest `c195ae7c5` |

## Goal steps with no recording

Steps the committed recordings hold no entry for in every run (e2e's `no-entry`), so they reach the model each time; they count as model answered above. e2e as published records nothing for a step that changed no control and no route on the tab it reads (`no-change` in [When a recording is written](https://e2e.com/docs/cache#when-a-recording-is-written)).

Arm 1: plain goals:

- modelLens › external › hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid [chromium], line 35, "hover the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": missed, no-entry. run 1 (47,379 tokens), run 2 (47,358 tokens), run 3 (47,305 tokens).
- structure › external › hovering a structure node highlights it on the page, and selecting it keeps it highlighted [chromium], line 33, "hover the node tagged {tag} in the Structure lens": missed, no-entry. run 1 (48,803 tokens), run 2 (66,238 tokens), run 3 (48,718 tokens).

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
