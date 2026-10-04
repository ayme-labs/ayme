# Test your integration

How to check in a Playwright test which tools your app publishes, and call them the way an agent does.

## The testing entry

`@ayme-dev/ayme/testing` installs a recording WebMCP driver into the browser, so a test sees exactly what the runtime publishes without a real WebMCP client. It uses Playwright's types and takes your test's own `Page` and `BrowserContext`. Only test code imports it.

| Function                                        | Does                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `recordPublishedTools(context)`                 | Installs the driver in every page the context opens. Call it before the page loads.                                              |
| `recordPublishedToolsLate(page)`                | Installs it into a page that has already loaded, to test a driver that appears after Ayme's initial wait.                        |
| `publishedToolNames(page)`                      | The names of the tools published now, in publication order.                                                                      |
| `publishedToolSchema(page, name)`               | A tool's `name`, `description` and `inputSchema`, or `null` while it is not published.                                           |
| `waitForPublishedTool(page, name, { timeout })` | Waits until a tool is published. It fails within `timeout`, 15 seconds by default, so a publication failure is reported as such. |
| `executePublishedTool(page, name, args)`        | Calls a published tool from the page and returns its result. Throws when no tool has that name.                                  |

The functions take the published name, so include your `toolNamePrefix` if you set one.

## A test

```ts
import { expect, test } from "@playwright/test";
import {
  executePublishedTool,
  publishedToolSchema,
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/ayme/testing";

test("publishes and runs GreetingPage.greet", async ({ context, page }) => {
  await recordPublishedTools(context);
  await page.goto("/");

  await waitForPublishedTool(page, "GreetingPage.greet");
  expect(
    (await publishedToolSchema(page, "GreetingPage.greet"))?.inputSchema
  ).toMatchObject({ required: ["name"] });

  const result = await executePublishedTool(page, "GreetingPage.greet", {
    name: "Ada",
  });
  expect(result).toMatchObject({ settled: true });
  await expect(page.getByText("Hello, Ada")).toBeVisible();
});
```

Publication has to be on in the app under test, as [Publish tools](publish-tools.md) shows. A published tool reports a failure as a result with `isError: true` rather than by throwing; [Errors](../reference/errors.md) shows its shape.

## Goals in tests

`goal` runs the Goal Loop against a real decision model, so its result varies from run to run. To test the rest of your integration deterministically, give the Goal Loop a fake decision function in the test build, or leave `goalLoop` unset there.
