# Page Object study: baselines

The "before" of the Page Object study (the [fixture's README](../../README.md)): each arm's suite on the Inspector before the redesign, measured by `pnpm study:baseline <arm1|arm2|arm3>` ([the script](../../scripts/study-baseline.mjs) says how), which rewrites this page from the data beside it. Each cell is the range over an arm's runs. Per test, and each run's own numbers: `<arm>.json`.

## The goal files' tests in every arm

| Arm                                 | Tests passed | Test time   | Goal steps | With no model call | Tokens          | e2e's cost estimate | Runs |
| ----------------------------------- | ------------ | ----------- | ---------- | ------------------ | --------------- | ------------------- | ---- |
| Arm 1: plain goals                  | 106 of 106   | 334 s–372 s | 334        | 325–326            | 433,820–482,352 | $0.33               | 3    |
| Arm 2: Page Objects                 | 106 of 106   | 155 s–163 s | none       | none               | none            | none                | 3    |
| Arm 3: goals with Page Object Tools | 106 of 106   | 279 s–357 s | 334        | 323–328            | 261,052–486,837 | $0.24–$0.46         | 3    |

## Arm 2's other tests

The tests with no action to turn into a goal (`LEFT_OUT` in [the mirror check](../../scripts/check-goal-mirror.mjs)).

| Arm                 | Tests passed | Test time | Goal steps | With no model call | Tokens | e2e's cost estimate | Runs |
| ------------------- | ------------ | --------- | ---------- | ------------------ | ------ | ------------------- | ---- |
| Arm 2: Page Objects | 15 of 15     | 27 s–29 s | none       | none               | none   | none                | 3    |

## Whole runs

Each run from e2e's start to its end, every test of the arm included; the tables above sum their tests' times. Recordings: the digest of the arm's cache, whose source `<arm>.json` names.

| Arm                                 | Tests passed | Wall time   | Commit      | Recordings  |
| ----------------------------------- | ------------ | ----------- | ----------- | ----------- |
| Arm 1: plain goals                  | 106 of 106   | 335 s–373 s | `3fbc4de54` | `19ff47386` |
| Arm 2: Page Objects                 | 121 of 121   | 183 s–193 s | `d086217d9` | none        |
| Arm 3: goals with Page Object Tools | 106 of 106   | 282 s–361 s | `d086217d9` | `a2ea7de9e` |

## Goal steps that reached the model

Arm 1: plain goals:

- detailRuns › external › a tool's page runs it from a card without a head, and What the model sees shows the definition snapshot gives, line 81, "open What the model sees": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- inspector › the layout and its sizes survive a reload, line 69, "drag the panel's {edge} edge {distance} px to the {direction}": missed, no-entry. Runs 1, 2, 3.
- inspector › the layout and its sizes survive a reload, line 83, "drag the panel's {edge} edge {distance} px to the {direction}": missed, no-entry. Runs 1, 2, 3.
- inspector › the layout and its sizes survive a reload, line 97, "drag the panel's {edge} edge {distance} px {direction}": missed, no-entry. Runs 1, 2, 3.
- modelLens › external › hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid, line 54, "select the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- runs › external › goal runs from the panel and shows in Runs with the Runs its steps executed and its Handover result, line 326, "open the Result of the latest {tool} run in Runs": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- runs › external › a run's result copies as the page's Run log has it, line 407, "copy the result of the latest {tool} run": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- structure › external › hovering a structure node highlights it on the page, and selecting it keeps it highlighted, line 37, "select the node tagged {tag} in the Structure lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- modelLens › inline › hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid, line 40, "hover the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded end state did not show on /models.html: missing node "locator('ayme-ref=e10')". Runs 2, 3.

Arm 3: goals with Page Object Tools:

- detailRuns › external › a tool's page runs it from a card without a head, and What the model sees shows the definition snapshot gives, line 81, "open What the model sees": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- modelLens › external › hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid, line 40, "hover the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1.
- modelLens › external › hovering a Page Object highlights it dashed on the page, and selecting it highlights it solid, line 54, "select the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- modelLens › external › hovering a member highlights it dashed, beside the selected Page Object's solid highlight, line 78, "select the row labelled "{item}", the {ordinal} row of the {collection} collection, under On this page in the Model lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1.
- runs › external › a non-POM target keeps its accessible name after clicking removes it and after reload, line 54, "show all runs in Runs": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2.
- runs › external › form fields keep their names and values without repeating their refs, line 110, "show all runs in Runs": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1.
- runs › external › a selection's chosen values show beside its readable target, line 159, "show all runs in Runs": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1.
- runs › external › goal runs from the panel and shows in Runs with the Runs its steps executed and its Handover result, line 326, "open the Result of the latest {tool} run in Runs": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- runs › external › a run's result copies as the page's Run log has it, line 407, "copy the result of the latest {tool} run": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- runs › external › press_key presses the key the page receives, line 440, "set the key to {key}": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
- structure › external › hovering a structure node highlights it on the page, and selecting it keeps it highlighted, line 37, "select the node tagged {tag} in the Structure lens": agent-concluded, end-mismatch, every recorded action ran, but the recorded outcome already showed on `ayme mcp`'s window /inspector before the replay acted there, so nothing proves the replay produced it. Runs 1, 2, 3.
