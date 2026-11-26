import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

/** Orders that refresh in steps, and a part the page renders late. */
export class LatePage extends FixturePage {
  readonly path = "/late.html";

  @ayme.child
  get refreshButton() {
    return this.page.getByRole("button", { name: "Refresh" });
  }

  // Not by its text, which is what changes.
  @ayme.child({
    description:
      'The refresh: "Never refreshed", "Refreshing", "Still refreshing", then "Refreshed".',
  })
  get refreshState() {
    return this.page.locator("#state");
  }

  @ayme.child({ description: "Shown once the page renders its late part." })
  get offer() {
    return this.page.locator("#offer");
  }

  /** Makes the page render its late part now, as it would by itself. */
  async showOffer() {
    await this.page.evaluate("window.showOffer()");
  }
}
