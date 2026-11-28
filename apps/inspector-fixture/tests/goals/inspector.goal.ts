import { describe, test as plainTest } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  callOverMcp,
  openFixture,
  outline,
  reloadFixture,
  testIn,
  confirmGoalRecordings,
} from "../e2e/fixtures";

// The goal-driven twin of ../inspector.e2e.ts: the same tests, with each
// action on the panel an agent goal.
//
// E2E: the built Inspector on fixture pages with a real Page Object and the
// ayme runtime, in the inline placement. Each test has one reason to fail;
// fixture and runtime problems fail first, in openFixture.

const test = testIn("inline");

test("the layout and its sizes survive a reload", async ({
  browser,
  agent,
  page,
  inspector,
}) => {
  const { header, shell } = inspector;
  const floating = await shell.box();
  await agent.act("set the layout to {layout}", {
    params: { layout: "Dock left" },
  });
  const dockedLeft = await shell.box();
  await agent.act("set the layout to {layout}", {
    params: { layout: "Dock to bottom" },
  });
  const dockedBottom = await shell.box();

  await reloadFixture(page, "/", inspector);

  await expect.poll(() => header.layoutMenu.current()).toBe("Dock to bottom");
  expect(await shell.box()).toEqual(dockedBottom);
  await agent.act("set the layout to {layout}", {
    params: { layout: "Dock left" },
  });
  await expect.poll(() => shell.box()).toEqual(dockedLeft);
  await agent.act("set the layout to {layout}", {
    params: { layout: "Floating" },
  });
  await expect.poll(() => shell.box()).toEqual(floating);

  await confirmGoalRecordings(browser);
});

test("a docked panel sits beside the page, and floating it gives the space back", async ({
  browser,
  agent,
  page,
  inspector,
}) => {
  const heading = page.on((screen) => screen.getByRole("heading", "Groceries"));
  const pageLeft = async () => (await (await heading.front()).boundingBox())!.x;
  const before = await pageLeft();

  await agent.act("set the layout to {layout}", {
    params: { layout: "Dock left" },
  });
  const panel = await inspector.shell.box();
  await expect.poll(pageLeft).toBeGreaterThanOrEqual(panel.x + panel.width);

  await agent.act("set the layout to {layout}", {
    params: { layout: "Floating" },
  });
  await expect.poll(pageLeft).toBe(before);

  await confirmGoalRecordings(browser);
});

test("the app's DOM gains no attribute while an element is highlighted", async ({
  agent,
  browser,
  listPage,
}) => {
  /** Every attribute of every element of the app, outside the panel's host and Playwright's overlay. */
  const attributes = () =>
    browser.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter(
          (element) =>
            !["ayme-inspector", "x-pw-glass"].includes(element.localName)
        )
        .map((element) =>
          [
            element.localName,
            ...[...element.attributes].map(
              ({ name, value }) => `${name}=${value}`
            ),
          ].join(" ")
        )
    );
  const before = await attributes();

  await agent.act("search the navigator for {query}", {
    params: { query: "Add item" },
  });
  await agent.act("select the search result {result}", {
    params: { result: 'button "Add item"' },
  });
  await agent.act("search the navigator for {query}", {
    params: { query: "New item" },
  });
  await browser.mouse.move(0, 0);
  await agent.act("hover the search result {result}", {
    params: { result: 'textbox "New item"' },
  });

  // Both highlights are showing.
  await expect.poll(outline(listPage.addItemButton, browser)).toBe("solid");
  await expect.poll(outline(listPage.newItemInput, browser)).toBe("dashed");
  expect(await attributes()).toEqual(before);

  await confirmGoalRecordings(browser);
});

test("a host member named like one of the panel's controls stays one match, and its tool runs", async ({
  browser,
  agent,
  appView,
  inspector,
  listPage,
}) => {
  await agent.act("open the {tool} tool in the Tools lens", {
    params: { tool: "ListPage.addItem" },
  });
  await agent.act("run it with the text {text}", { params: { text: "Milk" } });
  await expect(await listPage.items.front()).toHaveCount(1);
  // The panel now shows its own "Clear" button.
  await expect(await inspector.runs.clearButton.front()).toBeVisible();

  await expect(await listPage.clearButton.front()).toHaveCount(1);
  await appView.run("ListPage.clear");
  await expect(await listPage.items.front()).toHaveCount(0);

  await confirmGoalRecordings(browser);
});

test("the Structure view follows typing and text changes on the page", async ({
  agent,
  browser,
  page,
  inspector,
  listPage,
}) => {
  const structure = () => inspector.structure.treeText();
  await agent.act("show the {lens} lens", { params: { lens: "Structure" } });

  await listPage.newItemInput.fill("Oat milk");
  await expect.poll(structure).toContain("Oat milk");

  await page.front();
  await browser.evaluate(() => {
    const heading = [...document.querySelectorAll("h1, h2, h3")].find(
      (candidate) => candidate.textContent?.trim() === "Groceries"
    )!;
    heading.textContent = "Groceries for Friday";
    return null;
  });
  await expect.poll(structure).toContain('heading"Groceries for Friday"');

  await confirmGoalRecordings(browser);
});

describe("connected to an agent", () => {
  const connected = testIn("inline", "/", { connected: true });

  connected(
    "the Inspector's looks at the page leave the agent's view of it alone",
    async ({ agent, mcpServer, browser, page, inspector }) => {
      // The panel has looked at the page: its structure shows the heading.
      await agent.act("show the {lens} lens", {
        params: { lens: "Structure" },
      });
      await expect
        .poll(() => inspector.structure.treeText())
        .toContain("Groceries");

      // A toast appears, then the agent's first action changes nothing. Had
      // the panel's look been recorded, it would be the agent's "before" and
      // the toast would count as the action's change.
      await page.front();
      await browser.evaluate(() => {
        const toast = document.createElement("p");
        toast.setAttribute("role", "status");
        toast.textContent = "Saved";
        document.body.append(toast);
        return null;
      });
      const result = await callOverMcp(mcpServer!, "ListPage.countItems");

      expect(result).not.toHaveProperty("changes");

      await confirmGoalRecordings(browser);
    }
  );
});

test("the header's menus and switches work by mouse inside the closed shadow root", async ({
  browser,
  agent,
  inspector,
}) => {
  const { header } = inspector;

  // A press inside the panel must not count as a press outside the menu.
  await agent.act("open the Layout menu with the mouse");
  await agent.act("choose {layout} in the Layout menu with the mouse", {
    params: { layout: "Dock left" },
  });
  await expect.poll(() => header.layoutMenu.current()).toBe("Dock left");
  await expect(await header.layoutMenu.menu.front()).toHaveCount(0);

  await agent.act("press the theme switch once with the mouse");
  await expect.poll(() => header.themeSwitch.current()).toBe("Light");

  await agent.act("collapse the panel with the mouse");
  await expect(await inspector.logo.root.front()).toBeVisible();
  await agent.act("open the panel from the ayme logo with the mouse");
  await expect(await inspector.panel.front()).toBeVisible();

  await confirmGoalRecordings(browser);
});

plainTest(
  "with the tools published and no Agent Connection, the header says no agent and WebMCP is published",
  async ({ agent, app, browser, screen }) => {
    // The browser's WebMCP, which the runtime publishes its tools to.
    const { inspector } = await openFixture({ app, browser, screen }, "/", {
      webMCP: true,
    });
    const { connections } = inspector.header;

    await expect(await connections.pill.front()).toHaveText("No agent");
    await agent.act("open the Connections popover");
    await expect(await connections.agent.state.front()).toHaveText("Off");
    await expect(await connections.webMCP.state.front()).toHaveText(
      "Published"
    );

    await confirmGoalRecordings(browser);
  }
);

plainTest(
  "with WebMCP publishing off, the Connections popover says so and offers the option that turns it on",
  async ({ agent, app, browser, screen }) => {
    const { inspector } = await openFixture(
      { app, browser, screen },
      "/unpublished.html"
    );
    const { connections } = inspector.header;

    await agent.act("open the Connections popover");

    await expect(await connections.webMCP.state.front()).toHaveText("Off");
    await expect(await connections.webMCP.root.front()).toContainText(
      "webMCP: { enabled: true }"
    );
    await expect(await inspector.container.front()).not.toContainText(
      "can't call"
    );

    await confirmGoalRecordings(browser);
  }
);

describe("on a React host with aggressive global CSS", () => {
  const onReact = testIn("inline", "/react.html");

  onReact(
    "the panel works beside the host's own React",
    async ({ browser, agent, listPage }) => {
      await agent.act("open the {tool} tool in the Tools lens", {
        params: { tool: "ListPage.addItem" },
      });
      await agent.act("run it with the text {text}", {
        params: { text: "Eggs" },
      });

      await expect(
        await listPage.items
          .within((items) => items.filter({ hasText: "Eggs" }))
          .front()
      ).toHaveCount(1);

      await confirmGoalRecordings(browser);
    }
  );
});
