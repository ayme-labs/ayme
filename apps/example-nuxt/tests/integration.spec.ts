import { server } from "@ayme-dev/example-certification/config";
import {
  counterTests,
  devRebuildTests,
  serverRenderTests,
} from "@ayme-dev/example-certification/tests";
import { CounterPage } from "#pom/CounterPage";

// The shared certification, against nuxt dev and the built Nitro server.
serverRenderTests();
counterTests({
  CounterPage,
  inspector: server === "dev",
  navigation: {
    away: "Other",
    awayText: "Other page without Page Objects.",
    back: "Home",
  },
});
// Last: it edits a source file, and the dev server rebuilds after it.
devRebuildTests({
  counterModePath: new URL("../ayme/pom/CounterMode.ts", import.meta.url),
});
