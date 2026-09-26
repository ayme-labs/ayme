import type { Locator } from "@playwright/test";

/**
 * "What the model sees" in a detail view: the Page Object definitions and
 * tool schemas an agent receives. It starts collapsed.
 */
export class WhatTheModelSees {
  readonly root: Locator;
  readonly toggle: Locator;
  /** The Page Object definitions, as get_page_context renders them. */
  readonly definitions: Locator;

  constructor(scope: Locator) {
    this.root = scope.getByRole("region", {
      name: "What the model sees",
      exact: true,
    });
    this.toggle = this.root.getByRole("button", {
      name: /^What the model sees/,
    });
    this.definitions = this.root.getByLabel("Page object definitions", {
      exact: true,
    });
  }

  async open() {
    if ((await this.toggle.getAttribute("aria-expanded")) !== "true")
      await this.toggle.click();
  }

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
