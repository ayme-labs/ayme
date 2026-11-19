import { describe, expect, it } from "vitest";

import { interactionTitle } from "./entryText";
import { entryId } from "../../test-utils/ids";

const interaction = (details: Record<string, unknown>) => ({
  id: entryId("interaction_1"),
  type: "click",
  targetRef: "e5",
  ...details,
});

describe("how an Interaction reads in the window", () => {
  it("names a click", () => {
    expect(interactionTitle(interaction({}))).toBe("Click");
    expect(interactionTitle(interaction({ button: "left" }))).toBe("Click");
  });

  it("names a click of the middle button a middle click", () => {
    expect(interactionTitle(interaction({ button: "middle" }))).toBe(
      "Middle-click"
    );
  });

  it("names a click of the right button a right-click", () => {
    expect(interactionTitle(interaction({ button: "right" }))).toBe(
      "Right-click"
    );
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
      "Assert"
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
