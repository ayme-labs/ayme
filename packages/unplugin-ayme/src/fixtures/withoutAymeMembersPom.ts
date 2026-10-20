import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme
export class OrdersPage {
  static readonly route = "/orders";
  #opened = 0;
  readonly page: Page;
  title = "Orders";

  constructor(page: Page) {
    this.page = page;
  }

  get heading(): Locator {
    return this.page.getByRole("heading");
  }

  set filter(value: string) {
    void value;
  }

  reset() {
    const opened = this.#opened;
    this.#opened = 0;
    return opened;
  }

  @ayme.action({ description: "Refresh the orders." })
  async refresh() {
    this.#opened += 1;
    await this.page.reload();
  }
}
