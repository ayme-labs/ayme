import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

import type { ShopPage } from "./shopPage";

@ayme({ root: (self: CartItem) => self.row })
export class CartItem {
  readonly row!: Locator;

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
