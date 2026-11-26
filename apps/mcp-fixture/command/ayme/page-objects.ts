import type { AymeOptions } from "@ayme-dev/ayme";

import { Basket } from "./pom/Basket";
import { ShopPage } from "./pom/ShopPage";

/** The Page Objects a Session of the `ayme` command runs on `shop.html`. */
export default [ShopPage, Basket] satisfies AymeOptions["pageObjects"];
