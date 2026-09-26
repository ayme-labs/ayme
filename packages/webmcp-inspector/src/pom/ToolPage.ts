import type { Locator } from "@playwright/test";

import { WhatTheModelSees } from "./WhatTheModelSees";

/** A tool's page in the detail pane. */
export class ToolPage {
  readonly root: Locator;
  /** The tool's name. */
  readonly title: Locator;
  readonly description: Locator;
  /** A Page object tool's link to its Page Object Model. */
  readonly modelLink: Locator;
  readonly modelSees: WhatTheModelSees;

  constructor(detail: Locator) {
    this.root = detail.getByRole("article");
    this.title = this.root.getByRole("heading", { level: 2 });
    this.description = this.root.locator(":scope > p");
    this.modelLink = this.root.getByRole("button", {
      name: /page object model$/,
    });
    this.modelSees = new WhatTheModelSees(this.root);
  }
}
