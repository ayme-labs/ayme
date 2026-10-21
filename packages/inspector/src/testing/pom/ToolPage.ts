import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";
import { RunCard } from "./RunCard";
import { WhatTheModelSees } from "./WhatTheModelSees";

/** A tool's page in the detail pane. */
export class ToolPage extends PanelPart {
  /** The tool's name. */
  readonly title: Locator;
  readonly description: Locator;
  /** What kind of tool it is, e.g. "Browser tool" or "Node Peek tool". */
  readonly kind: Locator;
  /** A Page object tool's link to its Page Object Model. */
  readonly modelLink: Locator;
  readonly modelSees: WhatTheModelSees;
  /** The tool's run card. */
  readonly card: RunCard;

  constructor(detail: Locator) {
    super(detail.locator("article[data-tool-page]"));
    this.title = this.root.getByRole("heading", { level: 2 });
    this.description = this.root.locator(":scope > p");
    this.kind = this.root.locator("[data-tool-kind]");
    this.modelLink = this.root.getByRole("button", {
      name: /page object model$/,
    });
    this.modelSees = new WhatTheModelSees(this.root);
    this.card = new RunCard(this.root.getByRole("form"));
  }
}
