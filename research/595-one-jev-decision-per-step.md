# One Jev decision per Goal Loop step: measured on the Formbricks lab app

Research note for #595. Measured on 2026-10-15 on Abel's Mac, Jev through the lab app's Decision Endpoint, Formbricks submodule at 211ad704.

## Recommendation

Leave the stages as they are on main. The Goal Loop decisions change (#787, merged today) already asks a step's free values in stage one, and on the Formbricks missions with Page Objects every value a step takes is a free value. Every step there is now one request: 0 second requests in 60 steps, against 19 in 69 steps before it. The remaining two-request steps are the ones that pick an element (Browser Tools without Page Objects), and moving the element question into stage one is the side-by-side pick #787 measured at 112 wrong-element fills. No follow-up ticket.

## What was measured

Two builds, each driving both Formbricks missions 3 times through the `goal` tool alone, one scripted goal per screen (`pnpm eval:drive`), with every decision request recorded (`decisions.jsonl`) and read by stage (`pnpm eval:decisions stages`):

- **A**, main before #787 (76287c6): stage one asks the operation and `goal_met`; a free value is asked in stage two.
- **B**, main with #787 (9971864): stage one also asks a speculative Goal Value question per free parameter, read only for the chosen operation.

For A, every step that took a second request was then replayed 3 times, interleaved: the two recorded requests as they were (control), and one request carrying the stage-two questions next to the stage-one questions under their own ids, each prefixed "If the next operation is X" (combined; `pnpm eval:decisions replay`).

## Results

|                                                 | A: two stages                                       | B: free values in stage one          |
| ----------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| Runs passed, rename mission                     | 2 of 3 (one `step_budget`)                          | 3 of 3                               |
| Runs passed, sign-in mission                    | 3 of 3 (rename goal ends `action_failed` each time) | 3 of 3 (every edit goal ends `done`) |
| Steps with a second request                     | 19 of 69                                            | 0 of 60                              |
| Requests per run, rename mission                | 11, 8, 8                                            | 4, 4, 4                              |
| Requests per run, sign-in mission               | 21, 20, 20                                          | 16, 16, 16                           |
| Goal Loop input tokens per run, rename mission  | 64k, 44k, 35k                                       | 27k, 26k, 26k                        |
| Goal Loop input tokens per run, sign-in mission | 75k, 71k, 73k                                       | 69k, 69k, 70k                        |
| Median time per request                         | about 340 ms                                        | about 360 ms                         |

Every second request in A was one Goal Value question: `setSurveyName`, `setQuestionText`, `fillEmail`, `fillPassword`. None asked an element, an instance, an enum or a boolean. The Formbricks Page Objects take only free strings.

Replay of A's 19 two-request steps, 57 trials:

- **Values:** the combined request picked the same Goal Value as the control in 57 of 57, and the same as the recorded run in 57 of 57.
- **Operation:** the same as the control in 53 of 57. All 4 differences are in one run's steps 4 and 6, choosing between `setQuestionText` and `saveAndClose`, where the control itself flips between trials.
- **Cost:** median input tokens 5,749 for one request against 10,908 for two; median time 328 ms against 653 ms.

So asking the values in the same request as the operation lost no quality where the values are Goal Values, and halved the tokens and time of those steps. That is the change #787 made.

## The questions in #595

- **Question limit.** B adds up to 4 speculative questions per stage-one request here. On the first step, before any history, they cost about 700 input tokens (6.3k against 5.6k on the editor, 2.0k against 1.2k on sign-in). #787 caps them at 8 per request and leaves a parameter to stage two when its Goal Values would not fit one question; neither limit was reached.
- **Quality.** Unchanged for Goal Values (above). For elements it is worse: #787's bench measured the element and its value picked side by side in one request at 112 wrong-element fills over the fill goals, and 0 once the element is picked in stage two with the value named. An element picked in stage one, before the operation is known, has the same blind spot.
- **Cost.** One larger request costs about half of two smaller ones, because the page state travels once.
- **Simple cases.** A required closed set with exactly one option could skip stage two. It did not occur in B, and in A only as a single fitting Goal Value, which B now answers in stage one. Not worth its code today.

## Not measured

- The no-Page-Objects arms, where every element pick is still a second request: #787's bench has those numbers (2 requests per step).
- Goals as a coding agent writes them (often the whole mission in one call): the Mac has no Claude Code token for the agent arms, so the goals here are scripted per screen.

## Reproduce

In `apps/eval-formbricks` with the lab app running (`pnpm lab:dev`, with `AYME_OPENROUTER_API_KEY`):

```sh
pnpm eval:drive -- --runs 3
pnpm eval:drive -- --runs 3 --mission sign-in-create-and-revise-survey
pnpm eval:decisions stages results/drives/<run>...
pnpm eval:decisions replay --repeats 3 results/drives/<run>...
```
