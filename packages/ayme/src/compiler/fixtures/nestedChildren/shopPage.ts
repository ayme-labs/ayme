import { ayme } from "@ayme-dev/ayme";

import { Cart } from "./parts";

@ayme
export class ShopPage {
  @ayme.child
  cart!: Cart;
}
