import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";

/**
 * "What the model sees" in a detail view: a structure node's page state, the
 * Page Object definitions and the tool schemas an agent receives. It starts
 * collapsed.
 */
export class WhatTheModelSees extends PanelPart {
  readonly toggle: Locator;
  /** The Page Object definitions, as snapshot renders them. */
  readonly definitions: Locator;
  /**
   * A structure node's own lines of the page state, e.g.
   * `- e3 checkbox "Done" [checked]`, without its children.
   */
  readonly pageState: Locator;
  /** How many children the node has, e.g. "3 children". */
  readonly childCount: Locator;

  constructor(scope: Locator) {
    super(
      scope.getByRole("region", {
        name: "What the model sees",
        exact: true,
      })
    );
    this.toggle = this.root.getByRole("button", {
      name: /^What the model sees/,
    });
    this.definitions = this.root.getByLabel("Page object definitions", {
      exact: true,
    });
    this.pageState = this.root.getByLabel("Page state", { exact: true });
    this.childCount = this.root.getByText(/^\d+ child(ren)?$/);
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
