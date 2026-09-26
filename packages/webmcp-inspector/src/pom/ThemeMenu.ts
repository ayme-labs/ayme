import type { Locator } from "@playwright/test";

export type ThemeChoice = "System" | "Light" | "Dark";

/** The theme switch. Its menu portals into the Inspector's root. */
export class ThemeMenu {
  readonly trigger: Locator;
  private readonly root: Locator;

  /** @param root an element holding both the switch and the portal. */
  constructor(root: Locator) {
    this.root = root;
    this.trigger = root.getByRole("button", { name: /^Theme: / });
  }

  /** The option for a theme, while the menu is open. */
  option(choice: ThemeChoice): Locator {
    return this.root.getByRole("button", { name: choice, exact: true });
  }

  async choose(choice: ThemeChoice) {
    await this.trigger.click();
    await this.option(choice).click();
  }
}
