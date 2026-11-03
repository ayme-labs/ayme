import { expect, it } from "vitest";
import { nodeLabel, nodeText } from "./nodeDescription";

it("uses the accessible name before direct text and quotes embedded punctuation", () => {
  const node = {
    role: "button",
    name: 'Say "hi"',
    children: [{ role: "text", name: "Ignored" }],
  };
  expect(nodeText(node)).toBe(String.raw`"Say \"hi\""`);
  expect(nodeLabel(node)).toBe(String.raw`button "Say \"hi\""`);
});

it("falls back to direct text without borrowing another element's accessible name", () => {
  expect(nodeLabel({ role: "listitem", name: "", children: ["Milk"] })).toBe(
    "listitem Milk"
  );
  expect(
    nodeLabel({
      role: "listitem",
      name: "",
      children: [
        { role: "text", name: "Milk" },
        { role: "button", name: "Delete", ref: "e8" },
      ],
    })
  ).toBe("listitem Milk");
  expect(nodeLabel({ role: "button", name: "", children: [] })).toBe("button");
});
