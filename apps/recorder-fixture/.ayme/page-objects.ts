import type { AymeOptions } from "@ayme-dev/ayme";

import { CartPage } from "./pom/CartPage";
import { CheckoutPage } from "./pom/CheckoutPage";
import { GesturesPage } from "./pom/GesturesPage";
import { HelpPage } from "./pom/HelpPage";
import { InputsPage } from "./pom/InputsPage";
import { LatePage } from "./pom/LatePage";
import { LeavingPage } from "./pom/LeavingPage";
import { ShopPage } from "./pom/ShopPage";

export default [
  CartPage,
  CheckoutPage,
  GesturesPage,
  HelpPage,
  InputsPage,
  LatePage,
  LeavingPage,
  ShopPage,
] satisfies AymeOptions["pageObjects"];
