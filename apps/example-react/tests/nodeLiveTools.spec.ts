import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { exampleTest as test } from "@ayme-dev/example-certification/tests";
import {
  observePageObjects,
  probePomRootState,
  type PomManifest,
} from "@ayme-dev/ayme/playwright";

// Prototype: the same live Page Object Tools the browser runtime publishes,
// computed in Node over this real Playwright page. The example's shipped
// CounterPage declares no root, so this spec roots a copy of it at the
// counter's region and holds it as a Page Object Child of a rootless page.
class CounterSection {
  readonly incrementButton: Locator;
  readonly output: Locator;
  constructor(readonly root: Locator) {
    this.incrementButton = root.getByRole("button", {
      name: "Increment",
      exact: true,
    });
    this.output = root.locator("output");
  }
  async increment() {
    await this.incrementButton.click();
  }
}

class AppPage {
  readonly toggleButton: Locator;
  readonly counter: CounterSection;
  constructor(page: Page) {
    this.toggleButton = page.getByRole("button", {
      name: /Unmount counter|Mount counter/,
    });
    this.counter = new CounterSection(
      page.getByRole("region", { name: "Counter" })
    );
  }
  async toggleCounter() {
    await this.toggleButton.click();
  }
}

const noInput = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;
const tool = (methodName: string, toolName: string) => ({
  methodName,
  toolName,
  description: methodName,
  inputSchema: noInput,
  parameters: [],
});
// What `derivePomManifests` would derive from the classes above.
const manifest: PomManifest = {
  className: "AppPage",
  members: [
    { memberName: "toggleButton", kind: "locator", access: "field" },
    {
      memberName: "counter",
      kind: "component",
      access: "field",
      componentClassName: "CounterSection",
      collection: false,
    },
  ],
  components: [
    {
      className: "CounterSection",
      members: [
        { memberName: "root", kind: "locator", access: "field" },
        { memberName: "incrementButton", kind: "locator", access: "field" },
        { memberName: "output", kind: "locator", access: "field" },
      ],
      tools: [tool("increment", "increment")],
    },
  ],
  tools: [tool("toggleCounter", "AppPage.toggleCounter")],
};

const rootless = ["AppPage.toggleCounter"];
const withCounter = ["AppPage.toggleCounter", "AppPage.counter.increment"];

test("offers Page Object Tools from Node while their roots are live", async ({
  page,
}) => {
  await page.goto("/");
  const live = observePageObjects(page);
  const app = new AppPage(page);
  live.register(AppPage, manifest, app);
  const names = () => live.tools().map((t) => t.name);
  const run = (name: string) =>
    live
      .tools()
      .find((t) => t.name === name)!
      .execute({});

  await live.probe();
  expect(names()).toEqual(withCounter);

  // A live tool runs the method; Node answers with its plain result.
  expect(await run("AppPage.counter.increment")).toEqual({ result: null });
  await expect(app.counter.output).toHaveText("1");

  // Unmounting through the rootless tool withdraws the child's tool.
  await run("AppPage.toggleCounter");
  await live.probe();
  expect(names()).toEqual(rootless);

  // Mounting again, through the app, brings it back.
  await app.toggleButton.click();
  await live.probe();
  expect(names()).toEqual(withCounter);

  // A modal over the page: the root is present but not available (ADR-0020).
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "node-live-modal";
    dialog.textContent = "Modal";
    document.body.append(dialog);
    dialog.showModal();
  });
  await live.probe();
  expect(names()).toEqual(rootless);
  expect(await probePomRootState(app.counter.root)).toEqual({
    present: true,
    available: false,
  });
  await page.evaluate(() => {
    const dialog = document.getElementById(
      "node-live-modal"
    ) as HTMLDialogElement;
    dialog.close();
    dialog.remove();
  });
  await live.probe();
  expect(names()).toEqual(withCounter);

  await live.dispose();
});

test("wakes on page changes without an explicit probe, across a reload", async ({
  page,
}) => {
  await page.goto("/");
  const live = observePageObjects(page);
  const app = new AppPage(page);
  live.register(AppPage, manifest, app);
  const names = () => live.tools().map((t) => t.name);
  await live.probe();
  expect(names()).toEqual(withCounter);

  await app.toggleButton.click();
  await expect.poll(names).toEqual(rootless);

  await page.reload();
  await expect.poll(names).toEqual(withCounter);
  await app.toggleButton.click();
  await expect.poll(names).toEqual(rootless);

  await live.dispose();
});
