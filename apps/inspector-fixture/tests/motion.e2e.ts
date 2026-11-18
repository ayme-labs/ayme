import { expect } from "e2e";

import { testIn } from "./e2e/fixtures";
import type { Tab } from "./e2e/tab";

// E2E: the panel's motion with full motion, where the other specs run with
// reduced motion. Each test waits for the motion to end and checks where
// the panel ends up.

const test = testIn("inline", "/", { motion: "full" });

/**
 * Plays every animation on the page at this share of its speed. The
 * Playwright version sets the rate for the whole page through a CDP session,
 * which e2e does not open to a test; this sets each running animation's
 * `playbackRate`, every frame, so one that starts later is slowed within a
 * frame of starting.
 */
async function slowAnimations(page: Tab, rate: number) {
  await page.front();
  await page.browser.evaluate((rate: number) => {
    const state = window as unknown as { aymeE2eRate?: number };
    const running = state.aymeE2eRate !== undefined;
    state.aymeE2eRate = rate;
    if (running) return null;
    const keep = () => {
      for (const animation of document.getAnimations())
        if (animation.playbackRate !== state.aymeE2eRate)
          animation.playbackRate = state.aymeE2eRate!;
      requestAnimationFrame(keep);
    };
    keep();
    return null;
  }, rate);
}

type Probe = "look" | "parentLook" | "animations" | "count" | "mark" | "marked";

/**
 * Reads, or marks, the elements `selector` matches inside the Inspector's
 * closed root, through the hook its mount keeps for tests (see `panelTexts`
 * in `e2e/pom/Inspector.ts`). The panel and logo leave hidden from the
 * accessibility tree, which e2e's queries go by, so these read the elements
 * themselves, as the Playwright version does with `evaluate`.
 */
async function probe(tab: Tab, selector: string, what: Probe) {
  await tab.front();
  const json = await tab.browser.evaluate(
    ({ selector, what }: { selector: string; what: Probe }) => {
      const key = Symbol.for("@ayme-dev/inspector/shadow-root");
      const matches = [
        ...document.querySelectorAll("[data-ayme-inspector-host]"),
      ].flatMap((host) => [
        ...((host as unknown as Record<symbol, ShadowRoot | undefined>)[
          key
        ]?.querySelectorAll(selector) ?? []),
      ]);
      if (what === "count") return JSON.stringify(matches.length);
      const [element] = matches;
      if (!element) return JSON.stringify(null);
      const target = what === "parentLook" ? element.parentElement! : element;
      if (what === "look" || what === "parentLook") {
        const { opacity, scale } = getComputedStyle(target);
        return JSON.stringify({ opacity: Number(opacity), scale });
      }
      if (what === "animations")
        return JSON.stringify(target.getAnimations().length);
      if (what === "mark") {
        Object.assign(target, { sameAside: true });
        return JSON.stringify(true);
      }
      return JSON.stringify("sameAside" in target);
    },
    { selector, what }
  );
  return JSON.parse(json) as unknown;
}

const ASIDE = "[data-ayme-inspector-root] aside";
const LOGO = 'button[aria-label="Open ayme"]';
const open = { opacity: 1, scale: "none" };

test("a collapsed panel shrinks into the logo and is gone once it gets there", async ({
  inspector,
}) => {
  const { tab } = inspector;
  await inspector.collapse();

  await expect.poll(() => probe(tab, ASIDE, "count")).toBe(0);
  await expect(await inspector.logo.root.front()).toBeVisible();
  await expect.poll(() => probe(tab, LOGO, "parentLook")).toEqual(open);
});

test("the panel opens out of the logo to where it was, at its own size", async ({
  inspector,
}) => {
  const { tab, shell, logo } = inspector;
  const before = await shell.box();
  await inspector.collapse();
  await expect.poll(() => probe(tab, ASIDE, "count")).toBe(0);

  await logo.open();

  await expect.poll(() => probe(tab, ASIDE, "look")).toEqual(open);
  await expect.poll(() => probe(tab, LOGO, "count")).toBe(0);
  expect(await shell.box()).toEqual(before);
});

test("opening the logo before the panel has gone turns the same panel back", async ({
  page,
  inspector,
}) => {
  const { tab, panel, logo } = inspector;
  await slowAnimations(page, 0.1);
  await probe(tab, ASIDE, "mark");

  await inspector.collapse();
  await expect(await panel.front()).toHaveCount(0);
  await expect
    .poll(
      async () =>
        ((await probe(tab, ASIDE, "look")) as { opacity: number }).opacity
    )
    .toBeLessThan(0.9);
  // A plain tap waits until the growing logo holds still, and a tap at a
  // position still scrolls it into view first, which outlasts the panel's
  // exit; tapping its centre's viewport coordinates waits for neither, as
  // Playwright's `click({ force: true })` does.
  const box = (await (await logo.root.front()).boundingBox())!;
  await tab.screen.tapAt({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });

  await expect.poll(() => probe(tab, ASIDE, "look")).toEqual(open);
  expect(await probe(tab, ASIDE, "marked")).toBe(true);
  await expect.poll(() => probe(tab, LOGO, "count")).toBe(0);
});

// The panel on its way into the logo is out of the accessibility tree, so
// the page object finds only the logo there.
test("the page object opens a panel still on its way into the logo", async ({
  page,
  inspector,
}) => {
  await slowAnimations(page, 0.1);
  await inspector.collapse();
  await expect.poll(() => probe(inspector.tab, ASIDE, "count")).toBe(1);

  await inspector.open();
  await slowAnimations(page, 1);

  await expect.poll(() => probe(inspector.tab, ASIDE, "look")).toEqual(open);
});

// The body measures its regions as laid out, not as scaled while the panel
// grows in, so their ranges stay the same once it has.
test("the panel's regions keep their ranges after it opens out of the logo", async ({
  browser,
  inspector,
}) => {
  const divider = inspector.panel.within((panel) =>
    panel.getByRole("separator", "Resize the navigator")
  );
  const range = await divider.getAttribute("aria-valuemax");
  await inspector.collapse();
  await expect.poll(() => probe(inspector.tab, ASIDE, "count")).toBe(0);

  await inspector.logo.open();

  await expect.poll(() => probe(inspector.tab, ASIDE, "animations")).toBe(0);
  // Let a late resize report land, if one were coming.
  await browser.evaluate(
    () =>
      new Promise<null>((resolve) => requestAnimationFrame(() => resolve(null)))
  );
  await expect(await divider.front()).toHaveAttribute("aria-valuemax", range!);
});

test("a panel docked from the layout menu glides to the dock and stops there", async ({
  inspector,
}) => {
  await inspector.header.layoutMenu.choose("Dock right");

  await expect
    .poll(() => inspector.shell.box())
    .toEqual({ x: 640, y: 0, width: 640, height: 720 });
  await expect.poll(() => probe(inspector.tab, ASIDE, "animations")).toBe(0);
});

test("a panel dropped on an edge settles into the dock", async ({
  inspector,
}) => {
  await inspector.header.dropAt(4, 300);

  await expect
    .poll(() => inspector.shell.box())
    .toEqual({ x: 0, y: 0, width: 640, height: 720 });
  await expect.poll(() => probe(inspector.tab, ASIDE, "animations")).toBe(0);
});

test("switching the theme eases the panel across, then lets go", async ({
  page,
  inspector,
}) => {
  const { container, header } = inspector;
  await slowAnimations(page, 0.1);

  await header.themeSwitch.choose("Dark");

  await expect(await container.front()).toHaveAttribute("data-theme-switching");
  await expect(await container.front()).not.toHaveAttribute(
    "data-theme-switching",
    { timeout: 10_000 }
  );
  await expect.poll(() => probe(inspector.tab, ASIDE, "animations")).toBe(0);
});
