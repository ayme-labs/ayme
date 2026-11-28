import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";

/** One path in the Connections popover: WebMCP. */
export class ConnectionRow extends PanelPart {
  constructor(root: Locator) {
    super(root);
  }

  /** Its state in a word or two, such as "Published" or "Off". */
  @ayme.child
  get state(): Locator {
    return this.root.locator(":scope > div > span:last-child");
  }

  /** Its dot, whose `data-tone` says how the state reads: `ok`, `off`… */
  @ayme.child
  get dot(): Locator {
    return this.root.locator(":scope > div > [data-tone]");
  }

  /** The button that copies the option turning it on, while it is off. */
  @ayme.child
  get copyButton(): Locator {
    return this.root.getByRole("button", { name: /^Copy / });
  }

  /**
   * The check on the copy button, which shows just after a copy in place of
   * the copy icon. Lucide names each icon's SVG by its class.
   */
  get checkIcon(): Locator {
    return this.copyButton.locator("svg.lucide-check");
  }
}

/**
 * The header's Connections pill, which says whether agents in this browser
 * reach the page through WebMCP, and the popover it opens in the
 * Inspector's portal, with WebMCP's row.
 */
export class Connections extends PanelPart {
  /**
   * @param header the panel's header.
   * @param portalRoot an element holding the Inspector's portal.
   */
  constructor(
    header: Locator,
    private readonly portalRoot: Locator
  ) {
    super(header.getByRole("button", { name: /^Connections: / }));
  }

  @ayme.child
  get webMCP(): ConnectionRow {
    return new ConnectionRow(
      this.popover.getByRole("region", { name: "WebMCP", exact: true })
    );
  }

  /** The pill, its root: the Page Object is on the page while it shows. */
  get pill(): Locator {
    return this.root;
  }

  /** The pill's dot, whose `data-tone` says how WebMCP's state reads. */
  @ayme.child
  get pillDot(): Locator {
    return this.pill.locator("[data-tone]");
  }

  @ayme.child
  get popover(): Locator {
    return this.portalRoot.getByRole("dialog", { name: "Connections" });
  }

  @ayme.action({
    description:
      "Opens the Connections popover, which says how agents reach the page.",
  })
  async open() {
    if ((await this.pill.getAttribute("aria-expanded")) !== "true")
      await this.pill.click();
  }
}
