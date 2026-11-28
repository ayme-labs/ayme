import { describe, test as plainTest, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  callOverMcp,
  openFixture,
  outline,
  reloadFixture,
  testIn,
  confirmGoalRecordings,
} from "./e2e/fixtures";
import { AGENT_CLIENT_NAME } from "@ayme-dev/mcp/testing";

import { AppView } from "./e2e/appView";
import { panelLook, type Inspector } from "./e2e/pom/Inspector";

// E2E: the built Inspector on fixture pages with a real Page Object and the
// ayme runtime, in the inline placement. Each test has one reason to fail;
// fixture and runtime problems fail first, in openFixture.

const test = testIn("inline");

test("the layout and its sizes survive a reload", async ({
  browser,
  page,
  inspector,
}) => {
  const { header, shell } = inspector;
  const floating = await shell.box();
  await header.layoutMenu.choose("Dock left");
  const dockedLeft = await shell.box();
  await header.layoutMenu.choose("Dock to bottom");
  const dockedBottom = await shell.box();

  await reloadFixture(page, "/", inspector);

  await expect.poll(() => header.layoutMenu.current()).toBe("Dock to bottom");
  expect(await shell.box()).toEqual(dockedBottom);
  await header.layoutMenu.choose("Dock left");
  await expect.poll(() => shell.box()).toEqual(dockedLeft);
  await header.layoutMenu.choose("Floating");
  await expect.poll(() => shell.box()).toEqual(floating);

  await confirmGoalRecordings(browser);
});

test("a docked panel sits beside the page, and floating it gives the space back", async ({
  browser,
  page,
  inspector,
}) => {
  const heading = page.on((screen) => screen.getByRole("heading", "Groceries"));
  const pageLeft = async () => (await (await heading.front()).boundingBox())!.x;
  const before = await pageLeft();

  await inspector.header.layoutMenu.choose("Dock left");
  const panel = await inspector.shell.box();
  await expect.poll(pageLeft).toBeGreaterThanOrEqual(panel.x + panel.width);

  await inspector.header.layoutMenu.choose("Floating");
  await expect.poll(pageLeft).toBe(before);

  await confirmGoalRecordings(browser);
});

test("the app's DOM gains no attribute while an element is highlighted", async ({
  browser,
  inspector,
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

  await inspector.navigator.search("Add item");
  await inspector.navigator.result('button "Add item"').click();
  await inspector.navigator.search("New item");
  await browser.mouse.move(0, 0);
  await inspector.navigator.result('textbox "New item"').hover();

  // Both highlights are showing.
  await expect.poll(outline(listPage.addItemButton, browser)).toBe("solid");
  await expect.poll(outline(listPage.newItemInput, browser)).toBe("dashed");
  expect(await attributes()).toEqual(before);

  await confirmGoalRecordings(browser);
});

test("a host member named like one of the panel's controls stays one match, and its tool runs", async ({
  browser,
  appView,
  inspector,
  listPage,
}) => {
  await inspector.tool("ListPage.addItem");
  await inspector.detail.runCard().run({ text: "Milk" });
  await expect(await listPage.items.front()).toHaveCount(1);
  // The panel now shows its own "Clear" button.
  await expect(await inspector.runs.clearButton.front()).toBeVisible();

  await expect(await listPage.clearButton.front()).toHaveCount(1);
  await appView.run("ListPage.clear");
  await expect(await listPage.items.front()).toHaveCount(0);

  await confirmGoalRecordings(browser);
});

test("the Structure view follows typing and text changes on the page", async ({
  browser,
  page,
  inspector,
  listPage,
}) => {
  const structure = () => inspector.structure.treeText();
  await inspector.navigator.showLens("Structure");

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
    async ({ mcpServer, browser, page, inspector }) => {
      // The panel has looked at the page: its structure shows the heading.
      await inspector.navigator.showLens("Structure");
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

  // Its own budget: "Not connected" waits out the client's reconnect window
  // (RECONNECTING_MS in packages/mcp/src/client/index.ts).
  describe("after its server stops", { timeout: 60_000 }, () => {
    connected(
      "the Connections pill names the agent, then says Reconnecting once its server stops, then Not connected",
      async ({ mcpServer, inspector }) => {
        const { pill } = inspector.header.connections;
        await expect(await pill.front()).toHaveText(AGENT_CLIENT_NAME);

        const stopped = mcpServer!.close();
        await expect(await pill.front()).toHaveText("Reconnecting");
        await stopped;

        await expect(await pill.front()).toHaveText("Not connected", {
          timeout: 30_000,
        });
      }
    );
  });
});

test("the header's menus and switches work by mouse inside the closed shadow root", async ({
  browser,
  inspector,
}) => {
  const { header } = inspector;

  // A press inside the panel must not count as a press outside the menu.
  await header.layoutMenu.trigger.click();
  await header.layoutMenu.option("Dock left").click();
  await expect.poll(() => header.layoutMenu.current()).toBe("Dock left");
  await expect(await header.layoutMenu.menu.front()).toHaveCount(0);

  await header.themeSwitch.button.click();
  await expect.poll(() => header.themeSwitch.current()).toBe("Light");

  await inspector.collapse();
  await expect(await inspector.logo.root.front()).toBeVisible();
  await inspector.logo.open();
  await expect(await inspector.panel.front()).toBeVisible();

  await confirmGoalRecordings(browser);
});

plainTest(
  "with the tools published and no Agent Connection, the header says no agent and WebMCP is published",
  async ({ app, browser, screen }) => {
    // The browser's WebMCP, which the runtime publishes its tools to.
    const { inspector } = await openFixture({ app, browser, screen }, "/", {
      webMCP: true,
    });
    const { connections } = inspector.header;

    await expect(await connections.pill.front()).toHaveText("No agent");
    await connections.open();
    await expect(await connections.agent.state.front()).toHaveText("Off");
    await expect(await connections.webMCP.state.front()).toHaveText(
      "Published"
    );

    await confirmGoalRecordings(browser);
  }
);

plainTest(
  "with WebMCP publishing off, the Connections popover says so and offers the option that turns it on",
  async ({ app, browser, screen }) => {
    const { inspector } = await openFixture(
      { app, browser, screen },
      "/unpublished.html"
    );
    const { connections } = inspector.header;

    await connections.open();

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
    "there is exactly one Inspector under React StrictMode",
    async ({ inspector }) => {
      await expect(await inspector.container.front()).toHaveCount(1);
      await expect(await inspector.panel.front()).toBeVisible();
    }
  );

  onReact(
    "the panel works beside the host's own React",
    async ({ browser, inspector, listPage }) => {
      await inspector.tool("ListPage.addItem");
      await inspector.detail.runCard().run({ text: "Eggs" });

      await expect(
        await listPage.items
          .within((items) => items.filter({ hasText: "Eggs" }))
          .front()
      ).toHaveCount(1);

      await confirmGoalRecordings(browser);
    }
  );
});

const lookProperties = [
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-transform",
  "border-style",
  "padding",
  "margin",
];

/** How the panel looks: the styles host CSS would change if it leaked in. */
async function panelLooks(inspector: Inspector) {
  // Waits for each part, as Playwright's `evaluate` on a locator does; a part
  // the hook can't reach reads null, which must not compare equal.
  const look = async (selector: string) => {
    const read = () => panelLook(inspector.tab, selector, lookProperties);
    await expect
      .poll(read, { message: `Nothing in the Inspector matches ${selector}.` })
      .not.toBeNull();
    return (await read())!;
  };
  return {
    panel: await look('[aria-label="ayme"]'),
    title: await look("header h2"),
    button: await look('button[aria-label="Collapse inspector"]'),
  };
}

/** The element the pointer meets at the centre of the panel. */
async function elementOverPanel(browser: Browser, inspector: Inspector) {
  const box = await inspector.shell.box();
  return browser.evaluate(
    ([x, y]: number[]) => document.elementFromPoint(x!, y!)?.localName ?? null,
    [box.x + box.width / 2, box.y + box.height / 2]
  );
}

plainTest(
  "host CSS does not reach the panel",
  async ({ app, browser, screen }) => {
    const plain = await openFixture({ app, browser, screen }, "/");
    const unstyled = await panelLooks(plain.inspector);
    const unstyledBox = await plain.inspector.shell.box();

    const styled = await openFixture({ app, browser, screen }, "/react.html");

    expect(await panelLooks(styled.inspector)).toEqual(unstyled);
    expect(await styled.inspector.shell.box()).toEqual(unstyledBox);
    expect(await elementOverPanel(browser, styled.inspector)).toBe(
      "ayme-inspector"
    );
  }
);

plainTest(
  "the panel's CSS does not reach the host",
  async ({ app, browser, screen }) => {
    await openFixture({ app, browser, screen }, "/");

    // The browser's defaults, which the Inspector's CSS reset would change.
    // Polled, as Playwright's `toHaveCSS` retries.
    const styles = () =>
      browser.evaluate(() => {
        const heading = [...document.querySelectorAll("h1, h2, h3")].find(
          (candidate) => candidate.textContent?.trim() === "Groceries"
        )!;
        const button = [...document.querySelectorAll("main button")].find(
          (candidate) => candidate.textContent?.trim() === "Add item"
        )!;
        return {
          fontSize: getComputedStyle(heading).fontSize,
          fontWeight: getComputedStyle(heading).fontWeight,
          buttonBackground: getComputedStyle(button).backgroundColor,
        };
      });
    await expect.poll(async () => (await styles()).fontSize).toBe("32px");
    await expect.poll(async () => (await styles()).fontWeight).toBe("700");
    await expect
      .poll(async () => (await styles()).buttonBackground)
      .not.toBe("rgba(0, 0, 0, 0)");
  }
);

plainTest(
  "the legend counts what the page's runtime reports",
  async ({ app, browser, screen }) => {
    // The list page has a collection model with no item and no single child
    // missing; the models page has a single child missing. So a count of the
    // models not on the page and a count of the Page Object nodes not on it,
    // which the Model lens implements, differ on the first.
    for (const path of ["/", "/models.html"] as const) {
      const { inspector, page } = await openFixture(
        { app, browser, screen },
        path
      );
      const { live, notOnPage, refs } = await new AppView(page).legendCounts();

      await expect
        .poll(() => inspector.navigator.legendItems())
        .toEqual([`${live} live`, `${notOnPage} not on page`, `${refs} refs`]);
    }
  }
);
