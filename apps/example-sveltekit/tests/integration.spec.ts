import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";
import {
  counterTests,
  devRebuildTests,
  serverRenderTests,
  test,
} from "@ayme-dev/example-certification/tests";
import { recordPublishedTools } from "@ayme-dev/ayme/testing";
import { CounterPage } from "../src/lib/pom/CounterPage";

// The shared certification, against vite dev and the built adapter-node
// server, with server rendering and in SPA mode.
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

test("starts the runtime before the counter mounts", async ({
  context,
  page,
}) => {
  await recordPublishedTools(context);
  await page.goto("/");
  await expect(page.getByTestId("started")).toHaveText(
    "Runtime at child mount: started"
  );
});

// Last: it edits a source file, and the dev server rebuilds after it.
devRebuildTests({
  counterModePath: fileURLToPath(
    new URL("../src/lib/pom/CounterMode.ts", import.meta.url)
  ),
});
