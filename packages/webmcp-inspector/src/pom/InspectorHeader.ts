import type { Locator } from "@playwright/test";

import { ThemeMenu } from "./ThemeMenu";

/** The panel's header: title, page badge, theme switch and collapse. */
export class InspectorHeader {
  readonly root: Locator;
  readonly title: Locator;
  readonly badge: Locator;
  readonly collapseButton: Locator;
  readonly themeMenu: ThemeMenu;

  /**
   * @param root the header.
   * @param portalRoot an element holding the header and the Inspector's
   *   portal, where the theme menu opens.
   */
  constructor(root: Locator, portalRoot: Locator) {
    this.root = root;
    this.title = root.getByRole("heading", { name: "ayme", exact: true });
    // ponytail: the skeleton's badge counts POMs; board D's shows the page.
    this.badge = root.getByText(/\d+ POMs?$/);
    this.collapseButton = root.getByRole("button", {
      name: "Collapse inspector",
    });
    this.themeMenu = new ThemeMenu(portalRoot);
  }

  async collapse() {
    await this.collapseButton.click();
  }
}
