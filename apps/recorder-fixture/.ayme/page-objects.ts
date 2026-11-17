import type { AymeOptions } from "@ayme-dev/ayme";

import { ArrivalPage } from "./pom/ArrivalPage";
import { BasketPage } from "./pom/BasketPage";
import { CartPage } from "./pom/CartPage";
import { CatalogPage } from "./pom/CatalogPage";
import { CheckoutPage } from "./pom/CheckoutPage";
import { DepartingPage } from "./pom/DepartingPage";
import { GesturesPage } from "./pom/GesturesPage";
import { HelpPage } from "./pom/HelpPage";
import { InputsPage } from "./pom/InputsPage";
import { LatePage } from "./pom/LatePage";
import { LeavingPage } from "./pom/LeavingPage";
import { ShopPage } from "./pom/ShopPage";
import { WishlistPage } from "./pom/WishlistPage";

export default [
  ArrivalPage,
  BasketPage,
  CartPage,
  CatalogPage,
  CheckoutPage,
  DepartingPage,
  GesturesPage,
  HelpPage,
  InputsPage,
  LatePage,
  LeavingPage,
  ShopPage,
  WishlistPage,
] satisfies AymeOptions["pageObjects"];
