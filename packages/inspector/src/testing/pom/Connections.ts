import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/** One path in the Connections popover: the agent, or WebMCP. */
@ayme
export class ConnectionRow {
  readonly root: Locator;
  /** Its state in a word or two, such as "Connected" or "Off". */
  readonly state: Locator;
  /** The button that copies the option turning it on, while it is off. */
  readonly copyButton: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.state = root.locator(":scope > div > span:last-child");
    this.copyButton = root.getByRole("button", { name: /^Copy / });
  }
}

/**
 * The header's Connections pill, which says how the agent reaches the page,
 * and the popover it opens in the Inspector's portal: one row for the
 * Agent Connection and one for WebMCP.
 */
@ayme
export class Connections {
  /** The pill: the Page Object is on the page while it shows. */
  readonly root: Locator;
  readonly pill: Locator;
  readonly popover: Locator;
  readonly agent: ConnectionRow;
  readonly webMCP: ConnectionRow;

  /**
   * @param header the panel's header.
   * @param portalRoot an element holding the Inspector's portal.
   */
  constructor(header: Locator, portalRoot: Locator) {
    this.pill = header.getByRole("button", { name: /^Connections: / });
    this.root = this.pill;
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
