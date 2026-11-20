import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";
import { RunCard } from "./RunCard";
import { WhatTheModelSees } from "./WhatTheModelSees";

/** A tool's page in the detail pane. */
export class ToolPage extends PanelPart {
  @ayme.child
  readonly modelSees: WhatTheModelSees;
  /** The tool's run card. */
  @ayme.child
  readonly card: RunCard;

  constructor(detail: Locator) {
    super(detail.locator("article[data-tool-page]"));
    this.modelSees = new WhatTheModelSees(this.root);
    this.card = new RunCard(this.root.getByRole("form"));
  }

  /** The tool's name. */
  @ayme.child
  get title(): Locator {
    return this.root.getByRole("heading", { level: 2 });
  }

  /** The mark beside its name of a tool marked destructive. */
  @ayme.child
  get destructiveMark(): Locator {
    return this.root.locator(
      ":scope > div:first-child > [data-destructive-mark]"
    );
  }

  /** Its description; a tool without one shows none. */
  @ayme.child
  get description(): Locator {
    return this.root.locator(":scope > p");
  }

  /** What kind of tool it is, e.g. "Browser tool" or "Node Peek tool". */
  @ayme.child
  get kind(): Locator {
    return this.root.locator("[data-tool-kind]");
  }

  /** A Page object tool's link to its Page Object Model. */
  @ayme.child
  get modelLink(): Locator {
    return this.root.getByRole("button", { name: /page object model$/ });
  }

  /** Its description's text, or "" for a tool without one. */
  async descriptionText(): Promise<string> {
    return (await this.description.count())
      ? ((await this.description.textContent()) ?? "")
      : "";
  }
}
