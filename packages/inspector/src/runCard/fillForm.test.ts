import { describe, expect, it } from "vitest";

import type { ProjectedStructuralNodeForest } from "@ayme-dev/ayme/internal";

import type { ControlState } from "../shared/infrastructure/formControls";
import { forest, node } from "../adapter/projected.testSupport";
import { buildStructureTree } from "../adapter/structure";
import { changedFields, formRows, inFillOrder } from "./fillForm";

// A projected page state for a form with every field type.
const pageState = forest(
  node(
    { ref: "e2", role: "main" },
    node(
      { ref: "e3", role: "form", name: "Sign up" },
      node({ ref: "e4", role: "textbox", name: "Name" }, "Ada"),
      node({ ref: "e5", role: "textbox", name: "Notes" }, "line1 line2"),
      node({
        ref: "e6",
        role: "checkbox",
        name: "Agree",
        state: { checked: true },
      }),
      node({ ref: "e7", role: "button", name: "Help" }),
      node(
        { ref: "e8", role: "group", name: "Size" },
        node(
          { ref: "e9" },
          node({ ref: "e10", role: "radio", name: "Small" }),
          "Small"
        ),
        node(
          { ref: "e11" },
          node({
            ref: "e12",
            role: "radio",
            name: "Medium",
            state: { checked: true },
          }),
          "Medium"
        )
      ),
      node(
        { ref: "e13" },
        "Color",
        node(
          { ref: "e14", role: "combobox", name: "Color" },
          node({ ref: "e15", role: "option", name: "Red" }),
          node({
            ref: "e16",
            role: "option",
            name: "Green",
            state: { selected: true },
          })
        )
      ),
      node({ ref: "e17", role: "slider", name: "Volume" }, "4"),
      node({ ref: "e18", role: "spinbutton", name: "Quantity" }, "3")
    )
  )
);

function rowsOf(
  projected: ProjectedStructuralNodeForest,
  controls = new Map<string, ControlState>()
) {
  return formRows(
    buildStructureTree(projected, new Map(), undefined, controls).roots
  );
}

describe("formRows", () => {
  it("lists every fillable element in page order, with the value the page state shows", () => {
    expect(rowsOf(pageState)).toEqual([
      { key: "e4", type: "textbox", name: "Name", value: "Ada", preview: "e4" },
      {
        key: "e5",
        type: "textbox",
        name: "Notes",
        value: "line1 line2",
        preview: "e5",
      },
      {
        key: "e6",
        type: "checkbox",
        name: "Agree",
        value: "true",
        preview: "e6",
      },
      {
        key: "radio:e8",
        type: "radio",
        name: "Size",
        value: "e12",
        preview: "e8",
        options: [
          { label: "Small", value: "e10" },
          { label: "Medium", value: "e12" },
        ],
      },
      {
        key: "e14",
        type: "combobox",
        name: "Color",
        value: "Green",
        preview: "e14",
        options: [
          { label: "Red", value: "Red" },
          { label: "Green", value: "Green" },
        ],
      },
      {
        key: "e17",
        type: "slider",
        name: "Volume",
        value: "4",
        preview: "e17",
      },
    ]);
  });

  it("takes values, options and ranges from the controls the elements report", () => {
    const rows = rowsOf(
      pageState,
      new Map<string, ControlState>([
        ["e5", { value: "line1\nline2", multiline: true }],
        ["e6", { value: "false" }],
        ["e14", { value: "Blue", options: ["Red", "Blue"] }],
        ["e17", { value: "4", range: { min: 0, max: 10, step: 2 } }],
      ])
    );

    expect(rows.find((row) => row.key === "e5")).toMatchObject({
      value: "line1\nline2",
      multiline: true,
    });
    expect(rows.find((row) => row.key === "e6")?.value).toBe("false");
    expect(rows.find((row) => row.key === "e14")).toMatchObject({
      value: "Blue",
      options: [
        { label: "Red", value: "Red" },
        { label: "Blue", value: "Blue" },
      ],
    });
    expect(rows.find((row) => row.key === "e17")?.range).toEqual({
      min: 0,
      max: 10,
      step: 2,
    });
  });

  it("groups radios by their name, named by their radios outside a group", () => {
    const rows = rowsOf(
      forest(
        node(
          { ref: "e2", role: "main" },
          node({ ref: "e3", role: "radio", name: "Free" }),
          node({
            ref: "e4",
            role: "radio",
            name: "Pro",
            state: { checked: true },
          }),
          node({ ref: "e5", role: "radio", name: "Monthly" })
        )
      ),
      new Map<string, ControlState>([
        ["e3", { value: "false", group: "0:plan" }],
        ["e4", { value: "true", group: "0:plan" }],
        ["e5", { value: "false", group: "0:billing" }],
      ])
    );

    expect(rows).toEqual([
      {
        key: "radio:0:plan",
        type: "radio",
        name: "Free / Pro",
        value: "e4",
        preview: "e3",
        options: [
          { label: "Free", value: "e3" },
          { label: "Pro", value: "e4" },
        ],
      },
      {
        key: "radio:0:billing",
        type: "radio",
        name: "Monthly",
        value: "",
        preview: "e5",
        options: [{ label: "Monthly", value: "e5" }],
      },
    ]);
  });
});

describe("changedFields", () => {
  const rows = rowsOf(pageState);

  it("sends only the rows whose value differs from the page's, in the rows' order", () => {
    const edits = new Map([
      ["e14", "Red"],
      ["e4", "Ada"],
      ["e5", ""],
      ["e6", "false"],
      ["radio:e8", "e10"],
    ]);

    expect(changedFields(rows, edits)).toEqual([
      { target: "e5", name: "Notes", type: "textbox", value: "" },
      { target: "e6", name: "Agree", type: "checkbox", value: "false" },
      { target: "e10", name: "Small", type: "radio", value: "true" },
      { target: "e14", name: "Color", type: "combobox", value: "Red" },
    ]);
  });
});

describe("inFillOrder", () => {
  const rows = rowsOf(pageState);
  const keys = (order?: string[]) =>
    inFillOrder(rows, order).map((row) => row.key);

  it("keeps page order until the person reorders", () => {
    expect(keys()).toEqual(["e4", "e5", "e6", "radio:e8", "e14", "e17"]);
  });

  it("puts a row new since the reorder after the row before it in page order", () => {
    expect(keys(["e17", "e4", "e6", "radio:e8", "e14", "gone"])).toEqual([
      "e17",
      "e4",
      "e5",
      "e6",
      "radio:e8",
      "e14",
    ]);
  });
});
