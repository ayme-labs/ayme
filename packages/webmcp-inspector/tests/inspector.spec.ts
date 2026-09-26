import { expect, openFixture, test } from "./fixtures";
import type { Inspector } from "../src/testing";

// E2E: the built Inspector on fixture pages with a real Page Object, the
// Ayme runtime and Chromium's own WebMCP. Each test has one reason to fail;
// fixture, runtime and WebMCP problems fail first, in openFixture.

test("the page objects reach into the Inspector's open shadow root", async ({
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

test("the layout survives a reload", async ({ page, inspector }) => {
  await inspector.header.layoutMenu.choose("Dock to bottom");
  await inspector.shell.resizeBy("top", 0, -100);
  const docked = await inspector.shell.box();

  await openFixture(page, "/", { reload: true });

  await expect
    .poll(() => inspector.header.layoutMenu.current())
    .toBe("Dock to bottom");
  expect(await inspector.shell.box()).toEqual(docked);
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

test("host CSS does not reach the panel", async ({ page }) => {
  const plain = await openFixture(page, "/");
  const unstyled = await panelLook(plain.inspector);

  const styled = await openFixture(page, "/react.html");

  expect(await panelLook(styled.inspector)).toEqual(unstyled);
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
