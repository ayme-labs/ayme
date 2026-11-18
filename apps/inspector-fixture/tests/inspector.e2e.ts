import { describe, test as plainTest, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { openFixture, outline, reloadFixture, testIn } from "./e2e/fixtures";
import { panelLook, type Inspector } from "./e2e/pom/Inspector";

// E2E: the built Inspector on fixture pages with a real Page Object, the
// Ayme runtime and a recording WebMCP driver, in the inline placement. Each
// test has one reason to fail; fixture and runtime problems fail first, in
// openFixture.

const test = testIn("inline");

test("the page objects reach into the Inspector's closed shadow root", async ({
  inspector,
}) => {
  await expect(await inspector.header.title.front()).toBeVisible();
});

test("running a Page Object tool from the panel acts on the page", async ({
  inspector,
  listPage,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

  await expect(
    await listPage.items
      .within((items) => items.filter({ hasText: "Milk" }))
      .front()
  ).toHaveCount(1);
});

test("the panel follows the system theme", async ({ browser, inspector }) => {
  const colorScheme = async () =>
    (await panelLook(inspector.tab, '[aria-label="ayme"]', ["color-scheme"]))?.[
      "color-scheme"
    ];

  await browser.emulateMedia({ colorScheme: "light" });
  await expect.poll(colorScheme).toBe("light");

  await browser.emulateMedia({ colorScheme: "dark" });
  await expect.poll(colorScheme).toBe("dark");
});

test("the layout and its sizes survive a reload", async ({
  page,
  inspector,
}) => {
  const { header, shell } = inspector;
  await header.dragBy(-100, 50);
  await shell.resizeBy("left", -60, 0);
  const floating = await shell.box();
  await header.layoutMenu.choose("Dock left");
  await shell.resizeBy("right", 80, 0);
  const dockedLeft = await shell.box();
  await header.layoutMenu.choose("Dock to bottom");
  await shell.resizeBy("top", 0, -60);
  const dockedBottom = await shell.box();

  await reloadFixture(page, "/");

  await expect.poll(() => header.layoutMenu.current()).toBe("Dock to bottom");
  expect(await shell.box()).toEqual(dockedBottom);
  await header.layoutMenu.choose("Dock left");
  await expect.poll(() => shell.box()).toEqual(dockedLeft);
  await header.layoutMenu.choose("Floating");
  await expect.poll(() => shell.box()).toEqual(floating);
});

test("a collapsed panel stays collapsed after a reload", async ({
  page,
  inspector,
}) => {
  await inspector.collapse();

  await reloadFixture(page, "/");

  await expect(await inspector.logo.root.front()).toBeVisible();
  await expect(await inspector.panel.front()).toHaveCount(0);
});

test("a docked panel sits beside the page, and floating it gives the space back", async ({
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
});

test("the page highlights what's hovered in the panel and what's selected, at once", async ({
  browser,
  inspector,
  listPage,
}) => {
  const { navigator } = inspector;

  await navigator.search("Add item");
  await navigator.result('button "Add item"').click();
  await navigator.search("New item");
  // The new result can render right under the pointer left by the click,
  // and Chromium 156 sends no mouseenter for that; enter it from outside.
  await browser.mouse.move(0, 0);
  await navigator.result('textbox "New item"').hover();

  await expect.poll(outline(listPage.addItemButton, browser)).toBe("solid");
  await expect.poll(outline(listPage.newItemInput, browser)).toBe("dashed");
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
  const { navigator } = inspector;
  const before = await attributes();

  await navigator.search("Add item");
  await navigator.result('button "Add item"').click();
  await navigator.search("New item");
  await browser.mouse.move(0, 0);
  await navigator.result('textbox "New item"').hover();

  // Both highlights are showing.
  await expect.poll(outline(listPage.addItemButton, browser)).toBe("solid");
  await expect.poll(outline(listPage.newItemInput, browser)).toBe("dashed");
  expect(await attributes()).toEqual(before);
});

test("a host member named like one of the panel's controls stays one match, and its tool runs", async ({
  agentView,
  inspector,
  listPage,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });
  await expect(await listPage.items.front()).toHaveCount(1);
  // The panel now shows its own "Clear" button.
  await expect(await inspector.runs.clearButton.front()).toBeVisible();

  await expect(await listPage.clearButton.front()).toHaveCount(1);
  expect(await agentView.call("ListPage.clear", {})).not.toMatchObject({
    isError: true,
  });
  await expect(await listPage.items.front()).toHaveCount(0);
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
});

test("the Inspector's looks at the page leave the agent's view of it alone", async ({
  agentView,
  browser,
  page,
  inspector,
}) => {
  // The panel has looked at the page: its structure shows the heading.
  await inspector.navigator.showLens("Structure");
  await expect
    .poll(() => inspector.structure.treeText())
    .toContain("Groceries");

  // A toast appears, then the agent's first action changes nothing. Had the
  // panel's look been recorded, it would be the agent's "before" and the
  // toast would count as the action's change.
  await page.front();
  await browser.evaluate(() => {
    const toast = document.createElement("p");
    toast.setAttribute("role", "status");
    toast.textContent = "Saved";
    document.body.append(toast);
    return null;
  });
  const result = await agentView.call("ListPage.countItems", {});

  expect(result).toMatchObject({ page_changed: false });
});

test("the header's menus and switches work by mouse inside the closed shadow root", async ({
  inspector,
}) => {
  const { header } = inspector;

  // A press inside the panel must not count as a press outside the menu.
  for (const layout of [
    "Dock left",
    "Dock right",
    "Dock to bottom",
    "Floating",
  ] as const) {
    await header.layoutMenu.trigger.click();
    await header.layoutMenu.option(layout).click();
    await expect.poll(() => header.layoutMenu.current()).toBe(layout);
    await expect(await header.layoutMenu.menu.front()).toHaveCount(0);
  }

  for (const theme of ["Light", "Dark", "System"] as const) {
    await header.themeSwitch.button.click();
    await expect.poll(() => header.themeSwitch.current()).toBe(theme);
  }

  await inspector.collapse();
  await expect(await inspector.logo.root.front()).toBeVisible();
  await inspector.logo.open();
  await expect(await inspector.panel.front()).toBeVisible();
});

test("with the tools published and no Agent Connection, the header says no agent and WebMCP is published", async ({
  inspector,
}) => {
  const { connections } = inspector.header;

  await expect(await connections.pill.front()).toHaveText("No agent");
  await connections.open();
  await expect(await connections.agent.state.front()).toHaveText("Off");
  await expect(await connections.webMCP.state.front()).toHaveText("Published");
});

plainTest(
  "with WebMCP publishing off, the Connections popover says so and offers the option that turns it on",
  async (fixtures) => {
    const { inspector } = await openFixture(fixtures, "/unpublished.html");
    const { connections } = inspector.header;

    await connections.open();

    await expect(await connections.webMCP.state.front()).toHaveText("Off");
    await expect(await connections.webMCP.root.front()).toContainText(
      "webMCP: { enabled: true }"
    );
    await expect(await inspector.container.front()).not.toContainText(
      "can't call"
    );
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
    async ({ inspector, listPage }) => {
      await (await inspector.tool("ListPage.addItem")).run({ text: "Eggs" });

      await expect(
        await listPage.items
          .within((items) => items.filter({ hasText: "Eggs" }))
          .front()
      ).toHaveCount(1);
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
  const look = (selector: string) =>
    panelLook(inspector.tab, selector, lookProperties);
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

plainTest("host CSS does not reach the panel", async (fixtures) => {
  const plain = await openFixture(fixtures, "/");
  const unstyled = await panelLooks(plain.inspector);
  const unstyledBox = await plain.inspector.shell.box();

  const styled = await openFixture(fixtures, "/react.html");

  expect(await panelLooks(styled.inspector)).toEqual(unstyled);
  expect(await styled.inspector.shell.box()).toEqual(unstyledBox);
  expect(await elementOverPanel(fixtures.browser, styled.inspector)).toBe(
    "ayme-inspector"
  );
});

plainTest("the panel's CSS does not reach the host", async (fixtures) => {
  await openFixture(fixtures, "/");

  // The browser's defaults, which the Inspector's CSS reset would change.
  const styles = await fixtures.browser.evaluate(() => {
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
  expect(styles.fontSize).toBe("32px");
  expect(styles.fontWeight).toBe("700");
  expect(styles.buttonBackground).not.toBe("rgba(0, 0, 0, 0)");
});
