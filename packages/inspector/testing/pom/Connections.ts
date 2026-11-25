import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";

/** One path in the Connections popover: the agent, or WebMCP. */
export class ConnectionRow extends PanelPart {
  constructor(root: Locator) {
    super(root);
  }

  /** Its state in a word or two, such as "Connected" or "Off". */
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
   * Whether the copy button shows a check, as it does just after a copy,
   * rather than the copy icon. The copy icon draws a rectangle, a check does
   * not.
   */
  async showsCheck(): Promise<boolean> {
    return (await this.copyButton.locator("svg rect").count()) === 0;
  }
}

/**
 * The header's Connections pill, which says how the agent reaches the page,
 * and the popover it opens in the Inspector's portal: one row for the
 * Agent Connection and one for WebMCP.
 */
export class Connections extends PanelPart {
  @ayme.child
  readonly agent: ConnectionRow;
  @ayme.child
  readonly webMCP: ConnectionRow;

  /**
   * @param header the panel's header.
   * @param portalRoot an element holding the Inspector's portal.
   */
  constructor(
    header: Locator,
    private readonly portalRoot: Locator
  ) {
    super(header.getByRole("button", { name: /^Connections: / }));
    this.agent = new ConnectionRow(
      this.popover.getByRole("region", { name: "Agent", exact: true })
    );
    this.webMCP = new ConnectionRow(
      this.popover.getByRole("region", { name: "WebMCP", exact: true })
    );
  }

  /** The pill, its root: the Page Object is on the page while it shows. */
  get pill(): Locator {
    return this.root;
  }

  /** The pill's dot, whose `data-tone` says how the agent's state reads. */
  @ayme.child
  get pillDot(): Locator {
    return this.pill.locator("[data-tone]");
  }

  /**
   * The mark on the pill's corner while WebMCP is on and broken; its
   * `data-webmcp-mark` is WebMCP's state.
   */
  @ayme.child
  get mark(): Locator {
    return this.pill.locator("[data-webmcp-mark]");
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
