import {
  counterTests,
  devRebuildTests,
  serverRenderTests,
} from "@ayme-dev/example-certification/tests";
import { CounterPage } from "#pom/CounterPage";

// The shared certification, against next dev and the next build/next start app.
serverRenderTests();
counterTests({ CounterPage });
devRebuildTests({
  counterModePath: new URL("../ayme/pom/CounterMode.ts", import.meta.url),
});
