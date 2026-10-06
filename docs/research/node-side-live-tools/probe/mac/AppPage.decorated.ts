// Scratch pilot (not committed). The consumer-style twin of AppPage.ts, with
// the `@ayme` marks the compiler reads; derive-manifest.ts derives the
// manifests from this file. Keep both files' members and actions the same.
import { ayme } from "../../src/decorators";
import type { Locator, Page } from "@playwright/test";

@ayme({ description: "The counter section of the React example." })
export class CounterSection {
  readonly root: Locator;
  readonly incrementButton: Locator;

  constructor(page: Page) {
    this.root = page.getByRole("region", { name: "Counter" });
    this.incrementButton = this.root.getByRole("button", {
      name: "Increment",
      exact: true,
    });
  }

  @ayme.action({ description: "Increment the counter." })
  async increment() {
    await this.incrementButton.click();
  }
}

@ayme({ description: "The React example page." })
export class AppPage {
  readonly counter: CounterSection;
  readonly toggleButton: Locator;

  constructor(page: Page) {
    this.counter = new CounterSection(page);
    this.toggleButton = page.getByRole("button", {
      name: /(Unmount|Mount) counter/,
    });
  }

  @ayme.action({ description: "Mount or unmount the counter section." })
  async toggleCounter() {
    await this.toggleButton.click();
  }
}
