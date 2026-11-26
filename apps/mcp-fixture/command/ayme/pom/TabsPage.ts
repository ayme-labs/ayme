import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

/**
 * The fixture's `tabs.html`, present there alone. Its action opens a tab,
 * which comes to the front and hides the action's own, then goes on
 * clicking there: Playwright's click waits for animation frames, which
 * Chromium draws for a hidden tab only under focus emulation.
 */
@ayme({
  present: (self: TabsPage) =>
    new URL(self.page.url()).pathname === "/tabs.html",
})
export class TabsPage {
  constructor(readonly page: Page) {}

  @ayme.action({
    description: "Open a tab, which hides this one, then click Mark here.",
  })
  async openTabThenMark() {
    await Promise.all([
      this.page.waitForEvent("popup"),
      this.page.getByRole("button", { name: "Open a tab" }).click(),
    ]);
    await this.page.getByRole("button", { name: "Mark" }).click();
    return this.page.getByRole("status").textContent();
  }
}
