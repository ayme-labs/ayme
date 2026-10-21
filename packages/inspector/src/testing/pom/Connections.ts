import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";

/** One path in the Connections popover: the agent, or WebMCP. */
export class ConnectionRow extends PanelPart {
  /** Its state in a word or two, such as "Connected" or "Off". */
  readonly state: Locator;
  /** Its dot, whose `data-tone` says how the state reads: `ok`, `off`… */
  readonly dot: Locator;
  /** The button that copies the option turning it on, while it is off. */
  readonly copyButton: Locator;

  constructor(root: Locator) {
    super(root);
    this.state = root.locator(":scope > div > span:last-child");
    this.dot = root.locator(":scope > div > [data-tone]");
    this.copyButton = root.getByRole("button", { name: /^Copy / });
  }
}

/**
 * The header's Connections pill, which says how the agent reaches the page,
 * and the popover it opens in the Inspector's portal: one row for the
 * Agent Connection and one for WebMCP.
 */
export class Connections extends PanelPart {
  /** The pill, its root: the Page Object is on the page while it shows. */
  readonly pill: Locator;
  /** The pill's dot, whose `data-tone` says how the agent's state reads. */
  readonly pillDot: Locator;
  /**
   * The mark on the pill's corner while WebMCP is on and broken; its
   * `data-webmcp-mark` is WebMCP's state.
   */
  readonly mark: Locator;
  readonly popover: Locator;
  readonly agent: ConnectionRow;
  readonly webMCP: ConnectionRow;

  /**
   * @param header the panel's header.
   * @param portalRoot an element holding the Inspector's portal.
   */
  constructor(header: Locator, portalRoot: Locator) {
    super(header.getByRole("button", { name: /^Connections: / }));
    this.pill = this.root;
    this.pillDot = this.pill.locator("[data-tone]");
    this.mark = this.pill.locator("[data-webmcp-mark]");
    this.popover = portalRoot.getByRole("dialog", { name: "Connections" });
    this.agent = new ConnectionRow(
      this.popover.getByRole("region", { name: "Agent", exact: true })
    );
    this.webMCP = new ConnectionRow(
      this.popover.getByRole("region", { name: "WebMCP", exact: true })
    );
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
