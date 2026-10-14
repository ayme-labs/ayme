import { expect, it } from "vitest";

import { asksForArguments, press, runCardLook } from "./press";

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
  collection: false,
  target: undefined,
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
    { kind: "busy", opensForm: true },
  ],
  [
    "nothing while it runs with its form open",
    { running: true, needsInput: true, formOpen: true },
    { kind: "busy", opensForm: false },
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
    { collection: true, target: milk },
    { kind: "run", input: { ref: "e5", args }, item: milk },
  ],
  [
    "refuses a collection action with no item",
    { collection: true },
    { kind: "blocked", why: "no-item" },
  ],
] as const)("%s", (_, card, outcome) => {
  expect(press({ ...ready, ...card })).toEqual(outcome);
});

it.each([
  [{ kind: "opens-form" }, true],
  [{ kind: "busy", opensForm: true }, true],
  [{ kind: "busy", opensForm: false }, false],
  [{ kind: "run", input: args }, false],
] as const)("asks for the arguments first on %o: %s", (pressed, asks) => {
  expect(asksForArguments(pressed)).toBe(asks);
});

// How the card looks follows from the same state: Run is off whenever its
// press would do nothing.

const shown = {
  action: "add_item",
  present: true,
  running: false,
  needsInput: false,
  head: true,
  open: false,
  hasForm: false,
  invalid: false,
  args,
  collection: false,
  target: undefined,
};

it.each([
  ["busy", { running: true }, true, "Run add_item"],
  [
    "busy until the form is opened",
    { running: true, needsInput: true, hasForm: true },
    true,
    "Fill in the arguments, then run",
  ],
  [
    "invalid input",
    { open: true, hasForm: true, invalid: true },
    true,
    "Run add_item",
  ],
  [
    "a collection action with no item",
    { collection: true },
    true,
    "No item on the page to run on",
  ],
  [
    "opening the form",
    { needsInput: true, hasForm: true },
    false,
    "Fill in the arguments, then run",
  ],
  ["running", {}, false, "Run add_item"],
  [
    "running a collection action on its item",
    { collection: true, target: milk },
    false,
    "Run add_item",
  ],
] as const)("Run while %s: off %s, titled %s", (_, card, off, title) => {
  const look = runCardLook({ ...shown, ...card });
  expect(look.runDisabled).toBe(off);
  expect(look.runTitle).toBe(title);
});

it.each([
  ["a tool with fields", { hasForm: true }, true, false],
  ["a tool with fields, opened", { hasForm: true, open: true }, true, true],
  [
    "a collection action picking its item, opened",
    { hasForm: true, collection: true, open: true },
    true,
    true,
  ],
  ["a tool with nothing to fill in", {}, false, false],
  ["a tool without a head", { head: false }, false, true],
  [
    "an absent tool",
    { present: false, hasForm: true, open: true },
    false,
    false,
  ],
] as const)("%s: toggles %s, shows its form %s", (_, card, toggles, body) => {
  const look = runCardLook({ ...shown, ...card });
  expect(look.canToggle).toBe(toggles);
  expect(look.showBody).toBe(body);
});
