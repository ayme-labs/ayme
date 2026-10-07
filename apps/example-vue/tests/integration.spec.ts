import { fileURLToPath } from "node:url";

import {
  counterTests,
  devRebuildTests,
} from "@ayme-dev/example-certification/tests";
import { CounterPage } from "../playwright/pom/CounterPage";

// The shared certification, against the dev server and the production build,
// on the playground's `/counter` route. The app is a single-page app with no
// router, so it has no client navigation to check and no server-rendered page.
counterTests({ CounterPage });
// Last: it edits a source file, and the dev server rebuilds after it.
devRebuildTests({
  counterModePath: fileURLToPath(
    new URL("../playwright/pom/CounterMode.ts", import.meta.url)
  ),
});
