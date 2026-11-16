import type { AymeOptions } from "@ayme-dev/ayme";

import { PlainPage } from "./pom/PlainPage";

/**
 * The Page Objects `ayme mcp` serves to a page that does not ship Ayme, in
 * the shape of `createAyme`'s `pageObjects` option.
 */
export default [PlainPage] satisfies AymeOptions["pageObjects"];
