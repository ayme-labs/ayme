import type { Page } from "@playwright/test";
import { executePublishedTool } from "@ayme-dev/ayme/testing";

import { expect, openFixture, test } from "./fixtures";
import type { Inspector } from "../src/testing";

// E2E: the built Inspector on fixture pages with a real Page Object, the
// Ayme runtime and a recording WebMCP driver. Each test has one reason to
// fail; fixture and runtime problems fail first, in openFixture.

test("the page objects reach into the Inspector's closed shadow root", async ({
  inspector,
}) => {
  await expect(inspector.header.title).toBeVisible();
});

test("running a Page Object tool from the panel acts on the page", async ({
  inspector,
  listPage,
}) => {
  await (await inspector.tool("ListPage.addItem")).run({ text: "Milk" });

  await expect(listPage.items.filter({ hasText: "Milk" })).toHaveCount(1);
});

test("the panel follows the system theme", async ({ page, inspector }) => {
  const colorScheme = () =>
    inspector.panel.evaluate((panel) => getComputedStyle(panel).colorScheme);

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(colorScheme).toBe("light");

  await page.emulateMedia({ colorScheme: "dark" });
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

  await openFixture(page, "/", { reload: true });

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

  await openFixture(page, "/", { reload: true });

  await expect(inspector.logo.root).toBeVisible();
  await expect(inspector.panel).toHaveCount(0);
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

test("the page highlights what's hovered in the panel and what's selected, at once", async ({
  inspector,
  listPage,
}) => {
  const outline = (element: typeof listPage.addItemButton) =>
    element.evaluate((target) => getComputedStyle(target).outlineStyle);
  const { navigator } = inspector;

  await navigator.search("Add item");
  await navigator.result('button "Add item"').click();
  await navigator.search("New item");
  await navigator.result('textbox "New item"').hover();

  await expect.poll(() => outline(listPage.addItemButton)).toBe("solid");
  await expect.poll(() => outline(listPage.newItemInput)).toBe("dashed");
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
  expect(await executePublishedTool(page, "ListPage.clear")).not.toMatchObject({
    isError: true,
  });
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

test("the Inspector's looks at the page leave the agent's view of it alone", async ({
  page,
  inspector,
}) => {
  // The panel has looked at the page: its structure shows the heading.
  await inspector.navigator.showLens("Structure");
  await expect
    .poll(() => inspector.structure.tree.textContent())
    .toContain("Groceries");

  // A toast appears, then the agent's first action changes nothing. Had the
  // panel's look been recorded, it would be the agent's "before" and the
  // toast would count as the action's change.
  await page.evaluate(() => {
    const toast = document.createElement("p");
    toast.setAttribute("role", "status");
    toast.textContent = "Saved";
    document.body.append(toast);
  });
  const result = await executePublishedTool(page, "ListPage.countItems");

  expect(result).toMatchObject({ page_changed: false });
});

test("the header's menu and switches work by mouse inside the closed shadow root", async ({
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
    await expect(header.layoutMenu.menu).toHaveCount(0);
  }

  for (const theme of ["Light", "Dark", "System"] as const) {
    await header.themeSwitch.button.click();
    await expect.poll(() => header.themeSwitch.current()).toBe(theme);
  }

  await inspector.collapse();
  await expect(inspector.logo.root).toBeVisible();
  await inspector.logo.open();
  await expect(inspector.panel).toBeVisible();
});

test("the WebMCP status line is hidden while the tools are published", async ({
  inspector,
}) => {
  await expect(inspector.panel).toBeVisible();

  await expect(inspector.webMcpStatus.root).toHaveCount(0);
});

test("with WebMCP publishing off, the status line says so and how to turn it on", async ({
  page,
}) => {
  const { inspector } = await openFixture(page, "/unpublished.html");

  await expect(inspector.webMcpStatus.root).toContainText(
    "WebMCP publishing is off"
  );
  await expect(inspector.webMcpStatus.root).toContainText(
    "Set webMCP: { enabled: true } where the app starts Ayme."
  );
});

test("with WebMCP publishing off, the status line stays above every lens", async ({
  page,
}) => {
  const { inspector } = await openFixture(page, "/unpublished.html");

  for (const lens of ["Model", "Structure", "Tools"] as const) {
    await inspector.navigator.showLens(lens);
    await expect(inspector.webMcpStatus.root).toBeVisible();
    const status = (await inspector.webMcpStatus.root.boundingBox())!;
    const navigator = (await inspector.navigator.root.boundingBox())!;
    expect(status.y + status.height).toBeLessThanOrEqual(navigator.y);
  }
});

test.describe("on a React host with aggressive global CSS", () => {
  test.use({ fixturePath: "/react.html" });

  test("there is exactly one Inspector under React StrictMode", async ({
    inspector,
  }) => {
    await expect(inspector.root).toHaveCount(1);
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
