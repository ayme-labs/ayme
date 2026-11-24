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
import { LargePage } from "./pom/LargePage";
import { LatePage } from "./pom/LatePage";
import { LeavingPage } from "./pom/LeavingPage";
import { LoginPage } from "./pom/LoginPage";
import { NestedPage } from "./pom/NestedPage";
import { OutsideClickPage } from "./pom/OutsideClickPage";
import { SettlingPage } from "./pom/SettlingPage";
import { ShopPage } from "./pom/ShopPage";
import { TickingPage } from "./pom/TickingPage";
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
  LargePage,
  LatePage,
  LeavingPage,
  LoginPage,
  NestedPage,
  OutsideClickPage,
  SettlingPage,
  ShopPage,
  TickingPage,
  WishlistPage,
] satisfies AymeOptions["pageObjects"];
