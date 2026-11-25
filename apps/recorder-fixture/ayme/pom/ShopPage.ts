import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class ShopPage extends FixturePage {
  readonly path = "/shop.html";

  @ayme.child({ description: "Leaves the shop for the checkout." })
  get checkoutLink() {
    return this.page.getByRole("link", {
      name: "Go to checkout",
    });
  }

  @ayme.child({ description: "Opens the help in a page of its own." })
  get helpLink() {
    return this.page.getByRole("link", { name: "Help" });
  }
}
