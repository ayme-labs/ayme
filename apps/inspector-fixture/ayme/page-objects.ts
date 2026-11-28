import type { AymeOptions } from "@ayme-dev/ayme";

import { Inspector } from "./pom/Inspector";
import { ListPage } from "./pom/ListPage";

/** The Page Objects a Session of the `ayme` command runs on the dogfood
 * page, `dogfood.html`: the list app's and the Inspector's own. */
export default [ListPage, Inspector] satisfies AymeOptions["pageObjects"];
