import { fileURLToPath } from "node:url";

import {
  counterTests,
  devRebuildTests,
  serverRenderTests,
  test,
} from "@ayme-dev/example-certification/tests";
import { CounterPage } from "../playwright/pom/CounterPage";

// In development, Angular logs how many components it hydrated.
test.use({ hydrationStatistics: /^Angular hydrated / });

// The shared certification, against ng serve and the production build, for
// the SSR build and the spa build configuration.
serverRenderTests();
counterTests({
  CounterPage,
  inspector: "development",
  navigation: {
    away: "Other",
    awayText: "Other page without Page Objects.",
    back: "Home",
  },
});
// Last: it edits a source file, and the dev server rebuilds after it.
devRebuildTests({
  counterModePath: fileURLToPath(
    new URL("../playwright/pom/CounterMode.ts", import.meta.url)
  ),
});
