import { expect, it } from "vitest";

import { aRun, anInteraction, anItem } from "../test-utils/runs";
import type { RunInteraction, ToolArguments } from "./run";
import { runPresentation } from "./runPresentation";

it("shows one input once, without losing modifiers or other falsy arguments", () => {
  const interaction = anInteraction({
    operation: "fill",
    ref: "e7",
    target: 'textbox "Email"',
    value: "",
  });
  expect(
    runPresentation(
      aRun({
        toolName: "fill",
        arguments: { target: "e7", text: "", submit: false },
        interactions: [interaction],
      })
    )
  ).toEqual({ primary: interaction, value: "", arguments: { submit: false } });
});

it("keeps every interaction of custom and multi-input tools", () => {
  const interactions = [
    anInteraction(),
    anInteraction({ operation: "keyboard.press", value: "Enter" }),
  ];
  expect(
    runPresentation(aRun({ toolName: "type", interactions })).primary
  ).toBeUndefined();
  expect(
    runPresentation(
      aRun({
        arguments: { target: "custom data" },
        interactions: [anInteraction()],
      })
    )
  ).toEqual({ primary: undefined, arguments: { target: "custom data" } });
});

it("keeps a failed or running input's unresolved target visible", () => {
  expect(
    runPresentation(
      aRun({
        toolName: "click",
        status: "failed",
        arguments: { target: "e9", button: "right" },
      })
    )
  ).toEqual({
    primary: { operation: "click", locator: "e9" },
    arguments: { button: "right" },
  });
});

it("shows a keyboard input's key once without inventing a target", () => {
  const interaction = anInteraction({
    operation: "keyboard.press",
    locator: undefined,
    value: "Enter",
  });
  expect(
    runPresentation(
      aRun({
        toolName: "press_key",
        arguments: { key: "Enter" },
        interactions: [interaction],
      })
    )
  ).toEqual({ primary: interaction, value: "Enter", arguments: {} });
});

it("removes an item's redundant ref only when the displayed item actually identifies it", () => {
  const run = aRun({
    item: anItem("ListPage.items[1]", { ref: "e7", label: "Milk" }),
    arguments: { ref: "e7", args: { done: true } },
  });
  expect(runPresentation(run).arguments).toEqual({ args: { done: true } });
  expect(run.arguments.ref).toBe("e7");
  expect(
    runPresentation({ ...run, arguments: { ref: "e8" } }).arguments
  ).toEqual({ ref: "e8" });
});

it("removes only form targets already represented by readable interaction rows", () => {
  const fields = [
    { name: "Email", type: "textbox", target: "e7", value: "a@b" },
    { name: "Country", type: "combobox", target: "e8", value: "Germany" },
  ];
  const run = aRun({
    toolName: "fill_form",
    arguments: { fields },
    interactions: [
      anInteraction({
        operation: "fill",
        ref: "e7",
        target: 'textbox "Email"',
        value: "a@b",
      }),
    ],
  });
  expect(runPresentation(run).arguments).toEqual({
    fields: [{ name: "Email", type: "textbox", value: "a@b" }, fields[1]],
  });
  expect(fields[0]?.target).toBe("e7");
  expect(runPresentation({ ...run, interactions: [] }).arguments).toEqual({
    fields,
  });
  expect(
    runPresentation({ ...run, interactions: [anInteraction({ ref: "e7" })] })
      .arguments
  ).toEqual({ fields });
  expect(
    runPresentation({ ...run, toolName: "Form.submit" }).arguments
  ).toEqual({ fields });
});

it("shows selected options in the heading without flattening multi-selection or losing punctuation", () => {
  const values = ["Small, regular", 'Large "wide"'];
  const interaction = anInteraction({
    operation: "selectOption",
    ref: "e7",
    target: 'combobox "Size"',
  });
  const run = aRun({
    toolName: "select_option",
    arguments: { target: "e7", values },
    interactions: [interaction],
  });
  expect(runPresentation(run)).toEqual({
    primary: interaction,
    value: values,
    arguments: {},
  });
  expect(run.arguments.values).toEqual(values);
  expect(
    runPresentation({ ...run, arguments: { target: "e7", values: [] } }).value
  ).toEqual([]);
});

it.each([
  {
    toolName: "press_key",
    arguments: { key: "Escape" },
    primary: { operation: "press_key", value: "Escape" },
    value: "Escape",
    shown: {},
  },
  {
    toolName: "click",
    arguments: { key: "Escape" },
    primary: undefined,
    value: undefined,
    shown: { key: "Escape" },
  },
  {
    toolName: "press_key",
    arguments: { key: 1 },
    primary: undefined,
    value: undefined,
    shown: { key: 1 },
  },
])(
  "keeps unresolved keyboard arguments readable: $toolName $arguments",
  ({ toolName, arguments: args, primary, value, shown }) => {
    expect(runPresentation(aRun({ toolName, arguments: args }))).toEqual({
      primary,
      value,
      arguments: shown,
    });
  }
);

it("keeps a multi-input browser action's steps and removes only arguments represented by a step", () => {
  const interactions = [
    anInteraction({ value: "Milk" }),
    anInteraction({
      locator: undefined,
      operation: "keyboard.press",
      value: "Enter",
    }),
  ];
  const run = aRun({
    toolName: "type",
    arguments: { target: "e7", text: "Milk", key: "Escape" },
    interactions,
  });
  expect(runPresentation(run)).toEqual({
    primary: undefined,
    arguments: { key: "Escape" },
  });
  expect(
    runPresentation({ ...run, arguments: { target: "e7", text: "Other" } })
      .arguments
  ).toEqual({ text: "Other" });
  expect(
    runPresentation({
      ...run,
      interactions: interactions.map((input) => ({
        ...input,
        locator: undefined,
      })),
    }).arguments
  ).toEqual(run.arguments);
});

it.each<{
  toolName: string;
  arguments: ToolArguments;
  interactions: RunInteraction[];
  shown: ToolArguments;
}>([
  {
    toolName: "select_option",
    arguments: { target: "e7", values: [42] },
    interactions: [anInteraction()],
    shown: { values: [42] },
  },
  {
    toolName: "select_option",
    arguments: { target: "e7", values: "Large" },
    interactions: [anInteraction()],
    shown: { values: "Large" },
  },
  {
    toolName: "select_option",
    arguments: { values: ["Large"] },
    interactions: [],
    shown: { values: ["Large"] },
  },
  {
    toolName: "Form.submit",
    arguments: { values: ["Large"] },
    interactions: [anInteraction()],
    shown: { values: ["Large"] },
  },
  {
    toolName: "click",
    arguments: { values: ["Large"] },
    interactions: [anInteraction()],
    shown: { values: ["Large"] },
  },
])(
  "retains options that a heading cannot represent: $toolName $arguments",
  ({ shown, ...fields }) => {
    const presentation = runPresentation(aRun(fields));
    expect(presentation.value).toBeUndefined();
    expect(presentation.arguments).toEqual(shown);
  }
);

it("retains malformed saved form fields and fields without an element target", () => {
  const fields = [null, "Email", ["Email"], { target: "e7" }, { target: "e8" }];
  const interactions = fields.map(() =>
    anInteraction({ member: "Form.email" })
  );
  interactions[3] = anInteraction({ locator: undefined, target: "Email" });
  expect(
    runPresentation(
      aRun({ toolName: "fill_form", arguments: { fields }, interactions })
    ).arguments
  ).toEqual({ fields: [...fields.slice(0, 4), {}] });
});

it.each(["hover", "check", "uncheck"])(
  "shows a single %s input once in the heading",
  (toolName) => {
    const input = anInteraction({
      operation: toolName,
      member: "ListPage.urgent",
    });
    expect(
      runPresentation(
        aRun({ toolName, arguments: { target: "e7" }, interactions: [input] })
      )
    ).toEqual({ primary: input, arguments: {} });
  }
);
