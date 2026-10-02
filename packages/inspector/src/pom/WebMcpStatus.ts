import type { Locator } from "@playwright/test";

/**
 * The WebMCP status line under the header: why agents can't call the
 * panel's tools, and how to fix it. Absent while publication is active.
 */
export class WebMcpStatus {
  readonly root: Locator;

  constructor(panel: Locator) {
    this.root = panel.getByRole("status", { name: "WebMCP publication" });
  }
}
