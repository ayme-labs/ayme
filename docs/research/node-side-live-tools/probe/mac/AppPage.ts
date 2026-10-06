// Scratch pilot (not committed). Page Objects for apps/example-react, written
// to PR #500's convention: a rooted POM declares `readonly root: Locator`.
//
// This copy has no `@ayme` decorators because the pilot runs on Node's native
// type stripping, which rejects decorators (and parameter properties). The
// decorators are no-ops at run time; AppPage.decorated.ts is the consumer-style
// twin the compiler reads (derive-manifest.ts).
import type { Locator, Page } from "@playwright/test";

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

  async increment() {
    await this.incrementButton.click();
  }
}

// Rootless top-level POM: its own tools are live while it is registered; its
// child's tools follow the child's root (child discovery through members).
export class AppPage {
  readonly counter: CounterSection;
  readonly toggleButton: Locator;

  constructor(page: Page) {
    this.counter = new CounterSection(page);
    this.toggleButton = page.getByRole("button", {
      name: /(Unmount|Mount) counter/,
    });
  }

  async toggleCounter() {
    await this.toggleButton.click();
  }
}
