import type { AymeOptions } from "@ayme-dev/ayme";

import { AccountPage } from "./pom/AccountPage";
import { Basket } from "./pom/Basket";
import { GroceryList } from "./pom/GroceryList";
import { ShopPage } from "./pom/ShopPage";
import { SignInPage } from "./pom/SignInPage";
import { TabsPage } from "./pom/TabsPage";

/** The Page Objects a Session of the `ayme` command runs on the fixture's
 * pages without ayme, `shop.html`, `sign-in.html`, `account.html` and
 * `tabs.html`, and on its app page, `/`, which ships ayme. */
export default [
  ShopPage,
  Basket,
  SignInPage,
  AccountPage,
  TabsPage,
  GroceryList,
] satisfies AymeOptions["pageObjects"];
