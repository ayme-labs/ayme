import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class CatalogPage extends FixturePage {
  readonly path = "/catalog.html";

  @ayme.child({
    description: "Leads to the basket, whose page has this link as well.",
  })
  readonly basketLink = this.page.getByRole("link", { name: "Basket" });
  @ayme.child({
    description: "Leads to the wishlist, whose page has this link twice.",
  })
  readonly wishlistLink = this.page.getByRole("link", { name: "Wishlist" });
}
