import { fileURLToPath } from "node:url";

import {
  counterTests,
  devRebuildTests,
  serverRenderTests,
} from "@ayme-dev/example-certification/tests";
import { CounterPage } from "../playwright/pom/CounterPage";

// The shared certification, against nuxt dev and the built Nitro server.
serverRenderTests();
counterTests({ CounterPage, inspector: "development" });
// Last: it edits a source file, and the dev server rebuilds after it.
devRebuildTests({
  counterModePath: fileURLToPath(
    new URL("../playwright/pom/CounterMode.ts", import.meta.url)
  ),
});
