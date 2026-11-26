import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class CheckoutPage extends FixturePage {
  readonly path = "/checkout.html";

  @ayme.child
  get payButton() {
    return this.page.getByRole("button", { name: "Pay" });
  }

  // Not by its text, which is what changes: "Not paid", then "Paid".
  @ayme.child({ description: 'Whether it is paid: "Not paid" or "Paid".' })
  get paymentState() {
    return this.page.locator("#state");
  }

  @ayme.child({ description: "Shown once the page renders its late part." })
  get offer() {
    return this.page.getByText("Free delivery today");
  }

  /** Makes the page render its late part now, as it would by itself. */
  async showOffer() {
    await this.page.evaluate("window.showOffer()");
  }

  /** How many clicks this document has received. */
  async clicks(): Promise<number> {
    return (await this.page.evaluate("window.clicks")) as number;
  }
}
