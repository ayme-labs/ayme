import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { Connections } from "./Connections";
import { PanelPart } from "./PanelPart";
import { dragBy } from "./pointerDrag";

export type ThemeChoice = "System" | "Light" | "Dark";

export type LayoutChoice =
  "Floating" | "Dock left" | "Dock right" | "Dock to bottom";

/** The System / Light / Dark switch. Each press moves to the next theme. */
@ayme
export class ThemeSwitch {
  constructor(private readonly root: Locator) {}

  @ayme.child
  get button(): Locator {
    return this.root.getByRole("button", { name: /^Theme: / });
  }

  /** The theme it's set to. */
  async current(): Promise<ThemeChoice> {
    const name = (await this.button.getAttribute("aria-label")) ?? "";
    const current = /^Theme: (\w+)\./.exec(name)?.[1];
    if (current !== "System" && current !== "Light" && current !== "Dark")
      throw new Error(`The theme switch reads "${name}".`);
    return current;
  }

  @ayme.action
  async choose(choice: ThemeChoice) {
    for (let presses = 0; presses < 3; presses += 1) {
      if ((await this.current()) === choice) return;
      await this.button.click();
    }
    throw new Error(`The theme switch never reached ${choice}.`);
  }
}

/** The layout menu. It opens in the Inspector's portal. */
@ayme
export class LayoutMenu {
  /**
   * @param root the header.
   * @param portalRoot an element holding the Inspector's portal.
   */
  constructor(
    private readonly root: Locator,
    private readonly portalRoot: Locator
  ) {}

  @ayme.child
  get trigger(): Locator {
    return this.root.getByRole("button", { name: /^Layout: / });
  }

  @ayme.child
  get menu(): Locator {
    return this.portalRoot.getByRole("menu", { name: "Layout" });
  }

  /** The layout the panel is in. */
  async current(): Promise<LayoutChoice> {
    const name = (await this.trigger.getAttribute("aria-label")) ?? "";
    return name.replace(/^Layout: /, "") as LayoutChoice;
  }

  option(choice: LayoutChoice): Locator {
    return this.menu.getByRole("menuitemradio", { name: choice, exact: true });
  }

  @ayme.action({ description: "Moves the panel to a layout." })
  async choose(choice: LayoutChoice) {
    await this.trigger.click();
    await this.option(choice).click();
  }
}

/**
 * The panel's header: the title, the Connections pill, the theme switch,
 * the layout menu, collapse, and fullscreen where an Agent App offers it.
 * The panel drags by it.
 */
export class InspectorHeader extends PanelPart {
  @ayme.child
  readonly connections: Connections;
  @ayme.child
  readonly themeSwitch: ThemeSwitch;
  @ayme.child
  readonly layoutMenu: LayoutMenu;

  /**
   * @param root the header.
   * @param portalRoot an element holding the Inspector's portal, where the
   *   Connections popover and the layout menu open.
   */
  constructor(root: Locator, portalRoot: Locator) {
    super(root);
    this.connections = new Connections(root, portalRoot);
    this.themeSwitch = new ThemeSwitch(root);
    this.layoutMenu = new LayoutMenu(root, portalRoot);
  }

  @ayme.child
  get title(): Locator {
    return this.root.getByRole("heading", { name: "ayme", exact: true });
  }

  @ayme.child
  get collapseButton(): Locator {
    return this.root.getByRole("button", { name: "Collapse inspector" });
  }

  /** Fullscreen, or back from it: only in an Agent App that offers it. */
  @ayme.child
  get fullscreenButton(): Locator {
    return this.root.getByRole("button", {
      name: /^(Exit fullscreen|Fullscreen)$/,
    });
  }

  @ayme.action
  async collapse() {
    await this.collapseButton.click();
  }

  @ayme.action({
    description:
      "Asks the Agent App for fullscreen, or back from it. Only in an Agent App that offers fullscreen.",
  })
  async toggleFullscreen() {
    await this.fullscreenButton.click();
  }

  /** Drags the panel by its header. */
  @ayme.action({
    description: "Drags the panel by its header by a distance in pixels.",
  })
  async dragBy(deltaX: number, deltaY: number) {
    await dragBy(this.title, deltaX, deltaY);
  }

  /** Drags the panel by its header and drops it with the pointer here. */
  @ayme.action({
    description:
      "Drags the panel by its header and drops it at viewport coordinates.",
  })
  async dropAt(x: number, y: number) {
    const box = await this.title.boundingBox();
    if (!box) throw new Error("The header is not visible.");
    await this.dragBy(
      x - (box.x + box.width / 2),
      y - (box.y + box.height / 2)
    );
  }
}
