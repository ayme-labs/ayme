import type { Locator } from "@playwright/test";

import { RunCard } from "./RunCard";

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

  /** An action's run card, by the action's name, e.g. "addItem". */
  action(name: string): RunCard {
    return new RunCard(this.root.getByRole("form", { name, exact: true }));
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
}
