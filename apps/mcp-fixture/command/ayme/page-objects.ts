import type { AymeOptions } from "@ayme-dev/ayme";

import { AccountPage } from "./pom/AccountPage";
import { Basket } from "./pom/Basket";
import { ShopPage } from "./pom/ShopPage";
import { SignInPage } from "./pom/SignInPage";

/** The Page Objects a Session of the `ayme` command runs on the fixture's
 * pages without ayme: `shop.html`, `sign-in.html` and `account.html`. */
export default [
  ShopPage,
  Basket,
  SignInPage,
  AccountPage,
] satisfies AymeOptions["pageObjects"];
