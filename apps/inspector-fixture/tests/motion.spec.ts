import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// E2E: the panel's motion with full motion, where the other specs run with
// reduced motion. Each test waits for the motion to end and checks where
// the panel ends up.

test.use({ reducedMotion: "no-preference" });

/** Plays every animation on the page at this share of its speed. */
async function slowAnimations(page: Page, rate: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
}

/** The element's opacity and scale as they show now. */
function look(element: Locator) {
  return element.evaluate((target) => {
    const { opacity, scale } = getComputedStyle(target);
    return { opacity: Number(opacity), scale };
  });
}

function animations(element: Locator) {
  return element.evaluate((target) => target.getAnimations().length);
}

// The panel and logo leave hidden from the accessibility tree, which the
// role queries go by, so these read the elements themselves.
const aside = (container: Locator) => container.locator("aside");
const logoFrame = (container: Locator) =>
  container.locator('button[aria-label="Open ayme"]').locator("..");

test("a collapsed panel shrinks into the logo and is gone once it gets there", async ({
  inspector,
}) => {
  await inspector.collapse();

  await expect(aside(inspector.container)).toHaveCount(0);
  await expect(inspector.logo.root).toBeVisible();
  await expect
    .poll(() => look(logoFrame(inspector.container)))
    .toEqual({ opacity: 1, scale: "none" });
});

test("the panel opens out of the logo to where it was, at its own size", async ({
  inspector,
}) => {
  const { container, shell, logo, panel } = inspector;
  const open = await shell.box();
  await inspector.collapse();
  await expect(aside(container)).toHaveCount(0);

  await logo.open();

  await expect.poll(() => look(panel)).toEqual({ opacity: 1, scale: "none" });
  await expect(logoFrame(container)).toHaveCount(0);
  expect(await shell.box()).toEqual(open);
});

test("opening the logo before the panel has gone turns the same panel back", async ({
  page,
  inspector,
}) => {
  const { container, panel, logo } = inspector;
  const leaving = aside(container);
  await slowAnimations(page, 0.1);
  await leaving.evaluate((target) =>
    Object.assign(target, { sameAside: true })
  );

  await inspector.collapse();
  await expect(panel).toHaveCount(0);
  await expect
    .poll(async () => (await look(leaving)).opacity)
    .toBeLessThan(0.9);
  // A plain click waits until the growing logo holds still.
  await logo.root.click({ force: true });

  await expect.poll(() => look(panel)).toEqual({ opacity: 1, scale: "none" });
  expect(await panel.evaluate((target) => "sameAside" in target)).toBe(true);
  await expect(logoFrame(container)).toHaveCount(0);
});

// The panel on its way into the logo is out of the accessibility tree, so
// the page object finds only the logo there.
test("the page object opens a panel still on its way into the logo", async ({
  page,
  inspector,
}) => {
  await slowAnimations(page, 0.1);
  await inspector.collapse();
  await expect(aside(inspector.container)).toHaveCount(1);

  await inspector.open();
  await slowAnimations(page, 1);

  await expect
    .poll(() => look(inspector.panel))
    .toEqual({ opacity: 1, scale: "none" });
});

// The body measures its regions as laid out, not as scaled while the panel
// grows in, so their ranges stay the same once it has.
test("the panel's regions keep their ranges after it opens out of the logo", async ({
  page,
  inspector,
}) => {
  const divider = inspector.panel.getByRole("separator", {
    name: "Resize the navigator",
  });
  const range = await divider.getAttribute("aria-valuemax");
  await inspector.collapse();
  await expect(aside(inspector.container)).toHaveCount(0);

  await inspector.logo.open();

  await expect.poll(() => animations(inspector.panel)).toBe(0);
  // Let a late resize report land, if one were coming.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  );
  await expect(divider).toHaveAttribute("aria-valuemax", range!);
});

test("a panel docked from the layout menu glides to the dock and stops there", async ({
  inspector,
}) => {
  await inspector.header.layoutMenu.choose("Dock right");

  await expect
    .poll(() => inspector.shell.box())
    .toEqual({ x: 640, y: 0, width: 640, height: 720 });
  await expect.poll(() => animations(inspector.panel)).toBe(0);
});

test("a panel dropped on an edge settles into the dock", async ({
  inspector,
}) => {
  await inspector.header.dropAt(4, 300);

  await expect
    .poll(() => inspector.shell.box())
    .toEqual({ x: 0, y: 0, width: 640, height: 720 });
  await expect.poll(() => animations(inspector.panel)).toBe(0);
});

test("switching the theme eases the panel across, then lets go", async ({
  page,
  inspector,
}) => {
  const { container, header, panel } = inspector;
  await slowAnimations(page, 0.1);

  await header.themeSwitch.choose("Dark");

  await expect(container).toHaveAttribute("data-theme-switching");
  await expect(container).not.toHaveAttribute("data-theme-switching", {
    timeout: 10_000,
  });
  await expect.poll(() => animations(panel)).toBe(0);
});
