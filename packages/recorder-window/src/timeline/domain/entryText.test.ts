import { describe, expect, it } from "vitest";

import { interactionTitle, targetLabel } from "./entryText";

const interaction = (details: Record<string, unknown>) => ({
  id: "interaction_1",
  type: "click",
  targetRef: "e5",
  ...details,
});

describe("how an Interaction reads in the window", () => {
  it("names a click", () => {
    expect(interactionTitle(interaction({}))).toBe("Click");
  });

  it("names a key press with its key and typing with its text", () => {
    expect(interactionTitle(interaction({ type: "press", key: "Enter" }))).toBe(
      "Press Enter"
    );
    expect(interactionTitle(interaction({ type: "fill", text: "Milk" }))).toBe(
      "Fill 'Milk'"
    );
  });

  it("names an assertion that an element is visible", () => {
    expect(interactionTitle(interaction({ type: "assertVisible" }))).toBe(
      "Assert visible"
    );
  });

  it("names a key press with no key, or typing with no text, by its kind alone", () => {
    expect(interactionTitle(interaction({ type: "press" }))).toBe("Press");
    expect(interactionTitle(interaction({ type: "fill" }))).toBe("Fill");
  });

  it("names another kind by its own name, whatever key or text it carries", () => {
    expect(
      interactionTitle(interaction({ type: "click", key: "Enter", text: "Go" }))
    ).toBe("Click");
  });

  it("names any other kind by its own name", () => {
    expect(interactionTitle(interaction({ type: "uncheck" }))).toBe("Uncheck");
  });
});

describe("how its target reads", () => {
  it("reads a role selector as the role and its name", () => {
    expect(
      targetLabel(
        interaction({
          targetSelector: 'internal:role=button[name="Add item"i]',
        })
      )
    ).toBe('button "Add item"');
    expect(
      targetLabel(
        interaction({ targetSelector: 'internal:role=link[name="Cart"s]' })
      )
    ).toBe('link "Cart"');
  });

  it("reads a role without a name as the role", () => {
    expect(
      targetLabel(interaction({ targetSelector: "internal:role=checkbox" }))
    ).toBe("checkbox");
  });

  it("reads the element inside a frame by its own selector", () => {
    expect(
      targetLabel(
        interaction({
          targetSelector:
            'iframe[name="pay"] >> internal:control=enter-frame >> internal:role=button[name="Pay"i]',
        })
      )
    ).toBe('button "Pay"');
  });

  it("shows any other selector as it is", () => {
    expect(targetLabel(interaction({ targetSelector: "#add >> nth=1" }))).toBe(
      "#add >> nth=1"
    );
  });

  it("falls back to the Structural Ref, and to nothing when there is none", () => {
    expect(targetLabel(interaction({}))).toBe("[ref=e5]");
    expect(targetLabel(interaction({ targetRef: null }))).toBeNull();
  });
});
