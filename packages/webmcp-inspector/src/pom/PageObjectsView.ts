import type { Locator } from "@playwright/test";

import { ToolForm } from "./ToolForm";

/** A Page Object Model's card: its members and its tools. */
export class PomClassCard {
  readonly root: Locator;

  constructor(root: Locator) {
    this.root = root;
  }

  /** A member's row. Hovering highlights it on the page; pressing pins. */
  member(name: string): Locator {
    return this.root.locator(`[data-member-name="${name}"]`);
  }

  /** A member's probed state: present, absent, pending, ... */
  memberState(name: string): Locator {
    return this.member(name).locator("[data-member-state]");
  }

  tool(name: string): ToolForm {
    return new ToolForm(this.root.locator(`form[data-tool-name="${name}"]`));
  }
}

/** The Page objects view: one card per Page Object Model. */
export class PageObjectsView {
  readonly root: Locator;

  constructor(root: Locator) {
    this.root = root;
  }

  pomClass(name: string): PomClassCard {
    return new PomClassCard(this.root.locator(`[data-pom-class="${name}"]`));
  }

  /** A tool's form, whichever Page Object Model it belongs to. */
  tool(name: string): ToolForm {
    return new ToolForm(this.root.locator(`form[data-tool-name="${name}"]`));
  }
}
