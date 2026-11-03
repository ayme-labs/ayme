import { expect, it } from "vitest";

import { aRun, anInteraction, anItem } from "../test-utils/runs";
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
