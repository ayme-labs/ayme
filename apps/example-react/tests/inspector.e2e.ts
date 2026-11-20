import { expect } from "e2e";
import { exampleTest as test } from "@ayme-dev/example-certification/e2e/tests";
import { Inspector } from "@ayme-dev/example-certification/e2e/inspector";

test("opens the Inspector and runs a tool from it", async ({ app, screen }) => {
  await app.open("/");
  const inspector = new Inspector(screen);

  await inspector.open();
  await inspector.runTool("CounterPage.increment");

  await expect(
    screen.getByRole("region", "Counter").getByRole("status")
  ).toHaveText("1");
});
