# Page Object study: baselines

The "before" of the Page Object study (the [fixture's README](../../README.md)): each arm's suite on the Inspector before the redesign. Each cell is the range over the arm's three runs; each run's totals and exceptions are in `<arm>.json`.

## Measuring an arm

```sh
pnpm study:baseline arm1 --cache-from <a checkout>/apps/inspector-fixture/.e2e/goals-cache
pnpm study:baseline arm2
pnpm study:baseline arm3 --cache-from <a checkout>/apps/inspector-fixture/.e2e/goals-tools-cache
pnpm study:baseline render   # this page again, from the arms' files
```

Run it on your own machine from a committed tree, one arm at a time with nothing else running; a goal arm's hand-offs use this machine's Claude login. It builds the packages the fixture serves, warms one fixture server, runs the arm's own script three times on it, and saves the arm's file only when all three runs completed on one commit with the same recordings. The recordings are not in git (`.e2e/` is ignored): `--cache-from` copies them in and saves their digest and where they were made. Each run's full e2e report stays on the machine that ran it, at `.e2e/study/<arm>/<time>/run-<n>/report.json`, and is not published. [The script](../../scripts/study-baseline.mjs) holds each guard's reason.

## The tests every arm has

| Arm                                 | Tests passed | Summed test time | Goal steps | Replayed, no model call | Model answered | Unaccounted | Tokens          | e2e's cost estimate |
| ----------------------------------- | ------------ | ---------------- | ---------- | ----------------------- | -------------- | ----------- | --------------- | ------------------- |
| Arm 1: plain goals                  | 106 of 106   | 324 s–344 s      | 334        | 325–326                 | 8–9            | 0           | 434,085–499,132 | $0.29–$0.34         |
| Arm 2: Page Objects                 | 106 of 106   | 156 s–159 s      | none       | none                    | none           | none        | none            | none                |
| Arm 3: goals with Page Object Tools | 106 of 106   | 278 s–284 s      | 334        | 327–328                 | 6–7            | 0           | 261,007–303,046 | $0.24–$0.27         |

- Tokens are input plus output, prompt-cache reads and writes included; cache reads are 80%–86% of them. e2e's cost estimate is its own, from the same usage.
- Unaccounted: a goal step that neither replayed nor passed with the model, so its usage cannot be told.
- Every arm ran with one worker and no retries, so this is a serial comparison. The default test timeout is 30 s in arm 2 and 900 s in the goal arms ([e2e.config.ts](../../e2e.config.ts), [e2e.goals.config.ts](../../e2e.goals.config.ts)).

- Arm 1: plain goals: steps with no recording (missed, no-entry) used 264,695, 246,540, 244,329 tokens in its three runs, 49%–61% of its tokens. An attribution within these runs, not an estimate of a run without those steps: they shared an agent session with the arm's other steps.

## Arm 2's other tests

The tests with no action to turn into a goal (`LEFT_OUT` in [the mirror check](../../scripts/check-goal-mirror.mjs)).

| Arm                 | Tests passed | Summed test time |
| ------------------- | ------------ | ---------------- |
| Arm 2: Page Objects | 15 of 15     | 27 s–28 s        |

## Whole runs

Command wall time is the arm's script from start to exit, every test of the arm included.

| Arm                                 | Command wall time | Commit      | Recordings  | Copied from                                     |
| ----------------------------------- | ----------------- | ----------- | ----------- | ----------------------------------------------- |
| Arm 1: plain goals                  | 326 s–345 s       | `90b9adcc7` | `19ff47386` | t3/pilot-agentic-inspector-tests at `93ad5a556` |
| Arm 2: Page Objects                 | 185 s–189 s       | `90b9adcc7` | none        | none                                            |
| Arm 3: goals with Page Object Tools | 285 s–291 s       | `90b9adcc7` | `a2ea7de9e` | t3/port-e2e-tool-replay at `71e2bdcd9`          |

## Goal steps not replayed

By test and line, with e2e's reason, the runs each was in and its usage there.

Arm 1: plain goals:

- detailRuns › external › a tool's page runs it from a card without a head, and What the model sees shows the definition snapshot gives [chromium], line 81, "open What the model sees": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (35,698 tokens), run 2 (35,688 tokens), run 3 (35,692 tokens).
- inspector › the layout and its sizes survive a reload [chromium], line 69, "drag the panel's {edge} edge {distance} px to the {direction}": missed, no-entry. run 1 (83,269 tokens), run 2 (66,824 tokens), run 3 (66,533 tokens).
- inspector › the layout and its sizes survive a reload [chromium], line 83, "drag the panel's {edge} edge {distance} px to the {direction}": missed, no-entry. run 1 (82,850 tokens), run 2 (81,964 tokens), run 3 (81,227 tokens).
- inspector › the layout and its sizes survive a reload [chromium], line 97, "drag the panel's {edge} edge {distance} px {direction}": missed, no-entry. run 1 (98,576 tokens), run 2 (97,752 tokens), run 3 (96,569 tokens).
- modelLens › external › hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid [chromium], line 54, "select the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (31,356 tokens), run 2 (31,322 tokens), run 3 (31,328 tokens).
- runs › external › goal runs from the panel and shows in Runs with the Runs its steps executed and its Handover result [chromium], line 326, "open the Result of the latest {tool} run in Runs": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (35,202 tokens), run 2 (35,172 tokens), run 3 (52,912 tokens).
- runs › external › a run's result copies as the page's Run log has it [chromium], line 407, "copy the result of the latest {tool} run": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (33,248 tokens), run 2 (68,145 tokens), run 3 (33,268 tokens).
- structure › external › hovering a structure node highlights it on the page, and selecting it keeps it highlighted [chromium], line 37, "select the node tagged {tag} in the Structure lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (33,886 tokens), run 2 (33,880 tokens), run 3 (33,870 tokens).
- modelLens › inline › hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid [chromium], line 40, "hover the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded end state did not show on /models.html: missing node "locator('ayme-ref=e10')". run 2 (48,385 tokens), run 3 (48,459 tokens).

Arm 3: goals with Page Object Tools:

- detailRuns › external › a tool's page runs it from a card without a head, and What the model sees shows the definition snapshot gives [chromium], line 81, "open What the model sees": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (46,134 tokens), run 2 (46,160 tokens), run 3 (46,134 tokens).
- modelLens › external › hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid [chromium], line 54, "select the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (58,942 tokens), run 2 (39,198 tokens), run 3 (39,202 tokens).
- runs › external › goal runs from the panel and shows in Runs with the Runs its steps executed and its Handover result [chromium], line 326, "open the Result of the latest {tool} run in Runs": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (45,780 tokens), run 2 (45,834 tokens), run 3 (45,794 tokens).
- runs › external › a run's result copies as the page's Run log has it [chromium], line 407, "copy the result of the latest {tool} run": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (43,628 tokens), run 2 (43,550 tokens), run 3 (43,620 tokens).
- runs › external › press_key presses the key the page receives [chromium], line 440, "set the key to {key}": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (66,640 tokens), run 2 (44,331 tokens), run 3 (44,329 tokens).
- structure › external › hovering a structure node highlights it on the page, and selecting it keeps it highlighted [chromium], line 37, "select the node tagged {tag} in the Structure lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 1 (41,922 tokens), run 2 (41,938 tokens), run 3 (41,928 tokens).
- modelLens › external › hovering a member highlights it dashed, beside the selected Page Object's solid highlight [chromium], line 78, "select the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on http://127.0.0.1:<port>/inspector before the replay acted there, so nothing proves the replay produced it. run 2 (38,384 tokens).

## Tests that did not pass

None.
