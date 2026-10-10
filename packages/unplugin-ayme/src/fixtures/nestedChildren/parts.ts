import { ayme } from "@ayme-dev/ayme";

import type { ShopPage } from "./shopPage";

@ayme
export class CartItem {
  @ayme.action
  async backToShop(): Promise<ShopPage> {
    throw new Error("Not called.");
  }

  quantity(): number {
    return 1;
  }
}

@ayme
export class Cart {
  async items(): Promise<CartItem[]> {
    return [];
  }
}
