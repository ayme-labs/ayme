import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class WishlistPage extends FixturePage {
  readonly path = "/wishlist.html";

  @ayme.child({ description: "The header's and the footer's: two links." })
  readonly wishlistLinks = this.page.getByRole("link", { name: "Wishlist" });
}
