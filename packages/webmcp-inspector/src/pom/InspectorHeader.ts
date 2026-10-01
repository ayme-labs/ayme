import type { Locator } from "@playwright/test";

import { dragBy } from "./pointerDrag";

export type ThemeChoice = "System" | "Light" | "Dark";

export type LayoutChoice =
  "Floating" | "Dock left" | "Dock right" | "Dock to bottom";

/** The System / Light / Dark switch. Each press moves to the next theme. */
export class ThemeSwitch {
  readonly button: Locator;

  constructor(root: Locator) {
    this.button = root.getByRole("button", { name: /^Theme: / });
  }

  /** The theme it's set to. */
  async current(): Promise<ThemeChoice> {
    const name = (await this.button.getAttribute("aria-label")) ?? "";
    const current = /^Theme: (\w+)\./.exec(name)?.[1];
    if (current !== "System" && current !== "Light" && current !== "Dark")
      throw new Error(`The theme switch reads "${name}".`);
    return current;
  }

  async choose(choice: ThemeChoice) {
    for (let presses = 0; presses < 3; presses += 1) {
      if ((await this.current()) === choice) return;
      await this.button.click();
    }
    throw new Error(`The theme switch never reached ${choice}.`);
  }
}

/** The layout menu. It opens in the Inspector's portal. */
export class LayoutMenu {
  readonly trigger: Locator;
  readonly menu: Locator;

  /**
   * @param root the header.
   * @param portalRoot an element holding the Inspector's portal.
   */
  constructor(root: Locator, portalRoot: Locator) {
    this.trigger = root.getByRole("button", { name: /^Layout: / });
    this.menu = portalRoot.getByRole("menu", { name: "Layout" });
  }

  /** The layout the panel is in. */
  async current(): Promise<LayoutChoice> {
    const name = (await this.trigger.getAttribute("aria-label")) ?? "";
    return name.replace(/^Layout: /, "") as LayoutChoice;
  }

  option(choice: LayoutChoice): Locator {
    return this.menu.getByRole("menuitemradio", { name: choice, exact: true });
  }

  async choose(choice: LayoutChoice) {
    await this.trigger.click();
    await this.option(choice).click();
  }
}

/**
 * The panel's header: the title, the page badge, the theme switch, the
 * layout menu and collapse. The panel drags by it.
 */
export class InspectorHeader {
  readonly root: Locator;
  readonly title: Locator;
  /** The page's name, e.g. ListPage. */
  readonly pageBadge: Locator;
  readonly themeSwitch: ThemeSwitch;
  readonly layoutMenu: LayoutMenu;
  readonly collapseButton: Locator;

  /**
   * @param root the header.
   * @param portalRoot an element holding the Inspector's portal, where the
   *   layout menu opens.
   */
  constructor(root: Locator, portalRoot: Locator) {
    this.root = root;
    this.title = root.getByRole("heading", { name: "ayme", exact: true });
    this.pageBadge = root.locator("[data-slot=badge]");
    this.themeSwitch = new ThemeSwitch(root);
    this.layoutMenu = new LayoutMenu(root, portalRoot);
    this.collapseButton = root.getByRole("button", {
      name: "Collapse inspector",
    });
  }

  async collapse() {
    await this.collapseButton.click();
  }

  /** Drags the panel by its header. */
  async dragBy(deltaX: number, deltaY: number) {
    await dragBy(this.title, deltaX, deltaY);
  }

  /** Drags the panel by its header and drops it with the pointer here. */
  async dropAt(x: number, y: number) {
    const box = await this.title.boundingBox();
    if (!box) throw new Error("The header is not visible.");
    await this.dragBy(
      x - (box.x + box.width / 2),
      y - (box.y + box.height / 2)
    );
  }
}
