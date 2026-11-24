import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class CartPage extends FixturePage {
  readonly path = "/cart.html";

  @ayme.child({ description: 'How many items the cart holds: "Items: <n>".' })
  readonly itemCount = this.page.getByText("Items:");
  @ayme.child
  readonly addItemButton = this.page.getByRole("button", { name: "Add item" });
  @ayme.child({
    description:
      "Re-creates the Add item button as an element that looks the same, as a framework re-render does.",
  })
  readonly redrawButton = this.page.getByRole("button", { name: "Redraw" });

  /** How many times the page has re-created its Add item button. */
  async redraws(): Promise<number> {
    return (await this.page.evaluate("window.redraws")) as number;
  }
}
