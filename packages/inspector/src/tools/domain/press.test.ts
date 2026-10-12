import { expect, it } from "vitest";

import { press } from "./press";

// Unit tests: what pressing a run card's Run does.

const args = { text: "Milk" };
const milk = {
  path: "ListPage.items[0]",
  name: "[0]",
  pathBelowPage: "items[0]",
  ref: "e5",
  label: "Milk",
};
const ready = {
  present: true,
  running: false,
  needsInput: false,
  formOpen: false,
  invalid: false,
  args,
};

it.each([
  [
    "nothing while the tool is absent",
    { present: false, running: true },
    { kind: "absent" },
  ],
  [
    "nothing while it runs",
    { running: true, needsInput: true },
    { kind: "busy" },
  ],
  [
    "opens the closed form when it needs input",
    { needsInput: true, invalid: true },
    { kind: "opens-form" },
  ],
  [
    "runs once the form needing input is open",
    { needsInput: true, formOpen: true },
    { kind: "run", input: args },
  ],
  [
    "refuses invalid input",
    { formOpen: true, invalid: true },
    { kind: "blocked", why: "invalid-input" },
  ],
  ["runs at once with nothing to fill in", {}, { kind: "run", input: args }],
  [
    "runs a collection action on its item",
    { collection: { target: milk } },
    { kind: "run", input: { ref: "e5", args }, item: milk },
  ],
  [
    "refuses a collection action with no item",
    { collection: { target: undefined } },
    { kind: "blocked", why: "no-item" },
  ],
] as const)("%s", (_, card, outcome) => {
  expect(press({ ...ready, ...card })).toEqual(outcome);
});
