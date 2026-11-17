import type { AymeOptions } from "@ayme-dev/ayme";

import { BasketPage } from "./pom/BasketPage";
import { CartPage } from "./pom/CartPage";
import { CatalogPage } from "./pom/CatalogPage";
import { CheckoutPage } from "./pom/CheckoutPage";
import { GesturesPage } from "./pom/GesturesPage";
import { HelpPage } from "./pom/HelpPage";
import { InputsPage } from "./pom/InputsPage";
import { LatePage } from "./pom/LatePage";
import { LeavingPage } from "./pom/LeavingPage";
import { ShopPage } from "./pom/ShopPage";
import { WishlistPage } from "./pom/WishlistPage";

export default [
  BasketPage,
  CartPage,
  CatalogPage,
  CheckoutPage,
  GesturesPage,
  HelpPage,
  InputsPage,
  LatePage,
  LeavingPage,
  ShopPage,
  WishlistPage,
] satisfies AymeOptions["pageObjects"];
