import { server } from "@ayme-dev/example-certification/config";
import {
  counterTests,
  devRebuildTests,
  serverRenderTests,
} from "@ayme-dev/example-certification/tests";
import { CounterPage } from "../playwright/pom/CounterPage";

// The shared certification, against next dev and the next build/next start app.
serverRenderTests();
counterTests({ CounterPage, agentConnection: () => server === "dev" });
devRebuildTests({
  counterModePath: new URL("../playwright/pom/CounterMode.ts", import.meta.url),
});
