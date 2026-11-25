import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class BasketPage extends FixturePage {
  readonly path = "/basket.html";

  @ayme.child({ description: "The header's link, as on the catalog." })
  get basketLink() {
    return this.page.getByRole("link", { name: "Basket" });
  }
}
