import type { AymeOptions } from "@ayme-dev/ayme";

import { HiddenTabPage, PanelPage } from "./pom/HiddenTabPage";

/** Spike: the Page Objects the hidden tab spike's session runs. */
export default [HiddenTabPage, PanelPage] satisfies AymeOptions["pageObjects"];
