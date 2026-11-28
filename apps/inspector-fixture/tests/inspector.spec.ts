import type { Page } from "@playwright/test";
import { recordPublishedTools } from "@ayme-dev/webmcp/testing";
import { AGENT_CLIENT_NAME } from "@ayme-dev/mcp/testing";
import type { Inspector } from "@ayme-dev/inspector/testing";

import { AppView } from "./appView";
import { callOverMcp, expect, openFixture, outline, test } from "./fixtures";

test("the layout and its sizes survive a reload", async ({
  page,
  inspector,
}) => {
  const { header, shell } = inspector;
  const floating = await shell.box();
  await header.layoutMenu.choose("Dock left");
  const dockedLeft = await shell.box();
  await header.layoutMenu.choose("Dock to bottom");
  const dockedBottom = await shell.box();

  await openFixture(page, "/", { reload: true });

  await expect.poll(() => header.layoutMenu.current()).toBe("Dock to bottom");
  expect(await shell.box()).toEqual(dockedBottom);
  await header.layoutMenu.choose("Dock left");
  await expect.poll(() => shell.box()).toEqual(dockedLeft);
  await header.layoutMenu.choose("Floating");
  await expect.poll(() => shell.box()).toEqual(floating);
});

test("a docked panel sits beside the page, and floating it gives the space back", async ({
  page,
  inspector,
}) => {
  const heading = page.getByRole("heading", { name: "Groceries" });
  const pageLeft = async () => (await heading.boundingBox())!.x;
  const before = await pageLeft();

  await inspector.header.layoutMenu.choose("Dock left");
  const panel = await inspector.shell.box();
  await expect.poll(pageLeft).toBeGreaterThanOrEqual(panel.x + panel.width);

  await inspector.header.layoutMenu.choose("Floating");
  await expect.poll(pageLeft).toBe(before);
});

test("the app's DOM gains no attribute while an element is highlighted", async ({
  page,
  inspector,
  listPage,
}) => {
  /** Every attribute of every element of the app, outside the panel's host and Playwright's overlay. */
  const attributes = () =>
    page.evaluate(() =>
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
  const { navigator } = inspector;
  const before = await attributes();

  await navigator.search("Add item");
  await navigator.result('button "Add item"').click();
  await navigator.search("New item");
  await page.mouse.move(0, 0);
  await navigator.result('textbox "New item"').hover();

  // Both highlights are showing.
  await expect.poll(outline(listPage.addItemButton)).toBe("solid");
  await expect.poll(outline(listPage.newItemInput)).toBe("dashed");
  expect(await attributes()).toEqual(before);
});

test("a host member named like one of the panel's controls stays one match, and its tool runs", async ({
  page,
  inspector,
  listPage,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });
  await expect(listPage.items).toHaveCount(1);
  // The panel now shows its own "Clear" button.
  await expect(inspector.runs.clearButton).toBeVisible();

  await expect(listPage.clearButton).toHaveCount(1);
  await new AppView(page).run("ListPage.clear");
  await expect(listPage.items).toHaveCount(0);
});

test("the Structure view follows typing and text changes on the page", async ({
  page,
  inspector,
  listPage,
}) => {
  const structure = () => inspector.structure.tree.textContent();
  await inspector.navigator.showLens("Structure");

  await listPage.newItemInput.fill("Oat milk");
  await expect.poll(structure).toContain("Oat milk");

  await page
    .getByRole("heading", { name: "Groceries" })
    .evaluate((heading) => (heading.textContent = "Groceries for Friday"));
  await expect.poll(structure).toContain('heading"Groceries for Friday"');
});

test.describe("connected to an agent", () => {
  test.use({ connected: true });

  test("the Inspector's looks at the page leave the agent's view of it alone", async ({
    page,
    agent,
    inspector,
  }) => {
    // The panel has looked at the page: its structure shows the heading.
    await inspector.navigator.showLens("Structure");
    await expect
      .poll(() => inspector.structure.tree.textContent())
      .toContain("Groceries");

    // A toast appears, then the agent's first action changes nothing. Had
    // the panel's look been recorded, it would be the agent's "before" and
    // the toast would count as the action's change.
    await page.evaluate(() => {
      const toast = document.createElement("p");
      toast.setAttribute("role", "status");
      toast.textContent = "Saved";
      document.body.append(toast);
    });
    const result = await callOverMcp(agent!, "ListPage.countItems");

    expect(result).not.toHaveProperty("changes");
  });

  test("the Connections pill names the agent, then says Reconnecting once its server stops, then Not connected", async ({
    agent,
    inspector,
  }) => {
    // Its own budget: "Not connected" waits out the client's reconnect
    // window (RECONNECTING_MS in packages/mcp/src/client/index.ts).
    test.setTimeout(60_000);
    const { pill } = inspector.header.connections;
    await expect(pill).toHaveText(AGENT_CLIENT_NAME);

    const stopped = agent!.close();
    await expect(pill).toHaveText("Reconnecting");
    await stopped;

    await expect(pill).toHaveText("Not connected", { timeout: 30_000 });
  });
});

test("the header's menus and switches work by mouse inside the closed shadow root", async ({
  inspector,
}) => {
  const { header } = inspector;

  // A press inside the panel must not count as a press outside the menu.
  await header.layoutMenu.trigger.click();
  await header.layoutMenu.option("Dock left").click();
  await expect.poll(() => header.layoutMenu.current()).toBe("Dock left");
  await expect(header.layoutMenu.menu).toHaveCount(0);

  await header.themeSwitch.button.click();
  await expect.poll(() => header.themeSwitch.current()).toBe("Light");

  await inspector.collapse();
  await expect(inspector.logo.root).toBeVisible();
  await inspector.logo.open();
  await expect(inspector.panel).toBeVisible();
});

test("with the tools published and no Agent Connection, the header says no agent and WebMCP is published", async ({
  page,
  context,
}) => {
  // The browser's WebMCP, which the runtime publishes its tools to.
  await recordPublishedTools(context);
  const { inspector } = await openFixture(page, "/");
  const { connections } = inspector.header;

  await expect(connections.pill).toHaveText("No agent");
  await connections.open();
  await expect(connections.agent.state).toHaveText("Off");
  await expect(connections.webMCP.state).toHaveText("Published");
});

test("with WebMCP publishing off, the Connections popover says so and offers the option that turns it on", async ({
  page,
}) => {
  const { inspector } = await openFixture(page, "/unpublished.html");
  const { connections } = inspector.header;

  await connections.open();

  await expect(connections.webMCP.state).toHaveText("Off");
  await expect(connections.webMCP.root).toContainText(
    "webMCP: { enabled: true }"
  );
  await expect(inspector.container).not.toContainText("can't call");
});

test.describe("on a React host with aggressive global CSS", () => {
  test.use({ fixturePath: "/react.html" });

  test("there is exactly one Inspector under React StrictMode", async ({
    inspector,
  }) => {
    await expect(inspector.container).toHaveCount(1);
    await expect(inspector.panel).toBeVisible();
  });

  test("the panel works beside the host's own React", async ({
    inspector,
    listPage,
  }) => {
    await (await inspector.tool("ListPage.addItem")).run({ text: "Eggs" });

    await expect(listPage.items.filter({ hasText: "Eggs" })).toHaveCount(1);
  });
});

/** How the panel looks: the styles host CSS would change if it leaked in. */
async function panelLook(inspector: Inspector) {
  const look = (element: Element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      textTransform: style.textTransform,
      borderStyle: style.borderStyle,
      padding: style.padding,
      margin: style.margin,
    };
  };
  return {
    panel: await inspector.panel.evaluate(look),
    title: await inspector.header.title.evaluate(look),
    button: await inspector.header.collapseButton.evaluate(look),
  };
}

/** The element the pointer meets at the centre of the panel. */
async function elementOverPanel(page: Page, inspector: Inspector) {
  const box = (await inspector.panel.boundingBox())!;
  return page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.localName,
    [box.x + box.width / 2, box.y + box.height / 2]
  );
}

test("host CSS does not reach the panel", async ({ page }) => {
  const plain = await openFixture(page, "/");
  const unstyled = await panelLook(plain.inspector);
  const unstyledBox = await plain.inspector.panel.boundingBox();

  const styled = await openFixture(page, "/react.html");

  expect(await panelLook(styled.inspector)).toEqual(unstyled);
  expect(await styled.inspector.panel.boundingBox()).toEqual(unstyledBox);
  expect(await elementOverPanel(page, styled.inspector)).toBe("ayme-inspector");
});

test("the panel's CSS does not reach the host", async ({ page }) => {
  const { listPage } = await openFixture(page, "/");
  const heading = page.getByRole("heading", { name: "Groceries" });

  // The browser's defaults, which the Inspector's CSS reset would change.
  await expect(heading).toHaveCSS("font-size", "32px");
  await expect(heading).toHaveCSS("font-weight", "700");
  await expect(listPage.addItemButton).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)"
  );
});

test("the legend counts what the page's runtime reports", async ({ page }) => {
  // The list page has a collection model with no item and no single child
  // missing; the models page has a single child missing. So a count of the
  // models not on the page and a count of the Page Object nodes not on it,
  // which the Model lens implements, differ on the first.
  for (const path of ["/", "/models.html"] as const) {
    const { inspector } = await openFixture(page, path);
    const { live, notOnPage, refs } = await new AppView(page).legendCounts();

    await expect(
      inspector.navigator.legend.locator(":scope > span")
    ).toHaveText([`${live} live`, `${notOnPage} not on page`, `${refs} refs`]);
  }
});
