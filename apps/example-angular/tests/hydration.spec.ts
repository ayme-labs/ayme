import { expect } from "@playwright/test";
import { server, render } from "@ayme-dev/example-certification/config";
import { exampleTest as test } from "@ayme-dev/example-certification/tests";

test("hydrates every server-rendered component", async ({ page }) => {
  test.skip(
    server !== "dev" || render === "spa",
    "Only the server-rendered development build reports hydration."
  );
  const hydration: string[] = [];
  page.on("console", (message) => {
    if (/Angular hydrated/.test(message.text())) hydration.push(message.text());
  });

  await page.goto("/", { waitUntil: "networkidle" });

  expect(hydration).toEqual([
    expect.stringMatching(
      /hydrated 3 component\(s\).* 0 component\(s\) were skipped/
    ),
  ]);
});
