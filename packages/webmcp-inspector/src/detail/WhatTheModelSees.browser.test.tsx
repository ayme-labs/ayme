import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { renderPart } from "../renderPart";
import { WhatTheModelSees as WhatTheModelSeesPart } from "../testing";
import { WhatTheModelSees } from "./WhatTheModelSees";

// Component tests: the "What the model sees" block with fixture definitions
// and schemas, driven through its page object.

const page = createPage();
const modelSees = new WhatTheModelSeesPart(page.locator("body"));
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

const definitions =
  'POM ListPage // The list <main> page\n  items: ListItem[]\n\n  // Add an item to the list.\n  addItem(text: string, priority?: "low" | "high"): this';
const addItemSchema = {
  type: "object",
  properties: { text: { type: "string" }, priority: { enum: ["low", "high"] } },
  required: ["text"],
};

function renderBlock({ dark = false } = {}) {
  unmounts.push(
    renderPart(
      <WhatTheModelSees
        definitions={definitions}
        schemas={[{ name: "ListPage.addItem", inputSchema: addItemSchema }]}
      />,
      { dark }
    )
  );
}

it("starts collapsed and opens to the definitions and schemas", async () => {
  renderBlock();
  await expect
    .poll(() => modelSees.toggle.getAttribute("aria-expanded"))
    .toBe("false");
  expect(await modelSees.definitions.count()).toBe(0);

  await modelSees.open();

  await expect
    .poll(() => modelSees.definitions.textContent())
    .toBe(definitions);
  expect(await modelSees.schemaValue("ListPage.addItem")).toEqual(
    addItemSchema
  );

  await modelSees.close();

  await expect.poll(() => modelSees.definitions.count()).toBe(0);
});

it.each([false, true])(
  "highlights the syntax in the panel's theme (dark: %s)",
  async (dark) => {
    renderBlock({ dark });
    await modelSees.open();

    const colors = (code: typeof modelSees.definitions) =>
      code.evaluate((element) => {
        const background = getComputedStyle(
          element.closest("pre") ?? element
        ).backgroundColor;
        const text = [...element.querySelectorAll("span")]
          .filter((span) => span.children.length === 0 && span.textContent)
          .map((span) => getComputedStyle(span).color);
        return { background, text: [...new Set(text)] };
      });

    for (const code of [
      modelSees.definitions,
      modelSees.schema("ListPage.addItem"),
    ]) {
      const { background, text } = await colors(code);
      // Several colours, none of them unset or lost on the background.
      expect(text.length).toBeGreaterThan(2);
      expect(text).not.toContain(background);
      expect(text).not.toContain("rgba(0, 0, 0, 0)");
    }
  }
);
