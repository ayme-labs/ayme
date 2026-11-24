import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";

/**
 * "What the model sees" in a detail view: a structure node's page state, the
 * Page Object definitions and the tool schemas an agent receives. It starts
 * collapsed.
 */
export class WhatTheModelSees extends PanelPart {
  constructor(scope: Locator) {
    super(
      scope.getByRole("region", {
        name: "What the model sees",
        exact: true,
      })
    );
  }

  @ayme.child
  get toggle(): Locator {
    return this.root.getByRole("button", { name: /^What the model sees/ });
  }

  /** The Page Object definitions, as snapshot renders them. */
  @ayme.child
  get definitions(): Locator {
    return this.root.getByLabel("Page object definitions", { exact: true });
  }

  /**
   * A structure node's own lines of the page state, e.g.
   * `- e3 checkbox "Done" [checked]`, without its children.
   */
  @ayme.child
  get pageState(): Locator {
    return this.root.getByLabel("Page state", { exact: true });
  }

  /** How many children the node has, e.g. "3 children". */
  @ayme.child
  get childCount(): Locator {
    return this.root.getByText(/^\d+ child(ren)?$/);
  }

  @ayme.action
  async open() {
    if ((await this.toggle.getAttribute("aria-expanded")) !== "true")
      await this.toggle.click();
  }

  @ayme.action
  async close() {
    if ((await this.toggle.getAttribute("aria-expanded")) === "true")
      await this.toggle.click();
  }

  /** A tool's input schema, highlighted. */
  schema(toolName: string): Locator {
    return this.root.getByLabel(`${toolName} input schema`, { exact: true });
  }

  /** A tool's input schema, parsed from what the block shows. */
  async schemaValue(toolName: string): Promise<unknown> {
    return JSON.parse((await this.schema(toolName).textContent()) ?? "");
  }
}
