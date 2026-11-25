import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class WishlistPage extends FixturePage {
  readonly path = "/wishlist.html";

  @ayme.child({ description: "The header's and the footer's: two links." })
  get wishlistLinks() {
    return this.page.getByRole("link", { name: "Wishlist" });
  }
}
