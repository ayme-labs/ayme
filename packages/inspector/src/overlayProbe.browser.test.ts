// Research probe for #240, not a product test: what Playwright's highlight
// overlay does when the Inspector drives it through playwright-lite's
// supported API (`selectors.register` + `locator.highlight()`). Delete it
// once the research is settled.
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { page as vitestPage } from "vitest/browser";
import { createPage, selectors } from "@ayme-dev/playwright-lite";
import { captureAriaSnapshot } from "@ayme-dev/playwright-lite/internal";

/** Where the engine reads each layer's elements: page-global, like the Inspector's shadow-root hook. */
const KEY = Symbol.for("@ayme-dev/inspector/highlights");
type Layers = Record<string, Element[]>;
const layers: Layers = {};
(globalThis as unknown as Record<symbol, Layers>)[KEY] = layers;

// The engine is evaluated from source in the page's world: it can't close
// over anything here, so it reads the page-global key.
let engineQueries = 0;
(globalThis as unknown as Record<string, () => void>).__probeCount = () => {
  engineQueries++;
};
const engineSource = `({
  queryAll(root, layer) {
    globalThis.__probeCount?.();
    const elements = globalThis[Symbol.for("@ayme-dev/inspector/highlights")]?.[layer] ?? [];
    return elements.filter((element) => element.isConnected && root.contains(element));
  },
  query(root, layer) {
    return this.queryAll(root, layer)[0] ?? null;
  },
})`;

const page = createPage();

const styles = {
  hover:
    "background-color: transparent; outline: 2px dashed #d9a441; outline-offset: 3px",
  selection:
    "background-color: transparent; outline: 3px solid #d9a441; outline-offset: 3px; box-shadow: 0 0 0 5px rgb(217 164 65 / 18%)",
  unusable:
    "background-color: transparent; outline: 2px dashed #9ca3af; outline-offset: 3px",
};

// Test seam: the glass pane's shadow root is closed (isUnderTest is always
// false in lite), so capture it as it is attached.
let glassRoot: ShadowRoot | undefined;
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) {
  const root = attachShadow.call(this, init);
  if (this.localName === "x-pw-glass") glassRoot = root;
  return root;
};

beforeAll(async () => {
  await selectors.register("ayme-highlight", engineSource);
});

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  host.innerHTML = `
    <div style="height: 120px"></div>
    <button id="a" style="width: 100px; height: 30px">A</button>
    <button id="b" style="width: 100px; height: 30px">B</button>
    <button id="c" style="width: 100px; height: 30px">C</button>
    <div id="scroller" style="height: 60px; overflow: auto; border: 1px solid">
      <div style="height: 200px"></div>
      <button id="inner" style="width: 80px; height: 20px">Inner</button>
    </div>
    <div style="height: 2000px"></div>`;
  document.body.append(host);
});

afterEach(async () => {
  for (const key of Object.keys(layers)) delete layers[key];
  await page.hideHighlight();
  host.remove();
  window.scrollTo(0, 0);
  document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
});

const el = (id: string) => document.getElementById(id)!;
const glass = () => document.querySelector("x-pw-glass");
const frames = (n = 3) =>
  new Promise<void>((resolve) => {
    const step = (left: number) =>
      left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });

/** The rendered overlay boxes, in page coordinates rounded to px. */
function boxes() {
  return [...(glassRoot?.querySelectorAll("x-pw-highlight") ?? [])].map(
    (box) => {
      const style = (box as HTMLElement).style;
      return {
        x: Math.round(parseFloat(style.left)),
        y: Math.round(parseFloat(style.top)),
        w: Math.round(parseFloat(style.width)),
        h: Math.round(parseFloat(style.height)),
        outline: style.outline,
      };
    }
  );
}
function rect(element: Element) {
  const r = element.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}
const box = ({ x, y, w, h }: ReturnType<typeof boxes>[number]) => ({
  x,
  y,
  w,
  h,
});

async function show(layer: keyof typeof styles, ...elements: Element[]) {
  layers[layer] = elements;
  return page.locator(`ayme-highlight=${layer}`).highlight({
    style: styles[layer],
  });
}

it("draws in a top-layer glass pane on <html>, with a closed shadow root and no host attributes", async () => {
  const before = el("a").getAttributeNames();
  await show("hover", el("a"));
  await frames();

  expect(glass()?.parentElement).toBe(document.documentElement);
  expect(glass()?.shadowRoot).toBeNull();
  expect(glass()?.matches(":popover-open")).toBe(true);
  expect(getComputedStyle(glass()!).pointerEvents).toBe("none");
  expect(el("a").getAttributeNames()).toEqual(before);
  expect(boxes().map(box)).toEqual([rect(el("a"))]);
});

it("draws one box per element and keeps each layer's own style", async () => {
  await show("hover", el("a"));
  await show("selection", el("b"), el("c"));
  await show("unusable", el("inner"));
  await frames();

  const drawn = boxes();
  expect(drawn.map(box)).toEqual(
    [el("a"), el("b"), el("c"), el("inner")].map(rect)
  );
  expect(drawn.map((b) => b.outline)).toEqual([
    "rgb(217, 164, 65) dashed 2px",
    "rgb(217, 164, 65) solid 3px",
    "rgb(217, 164, 65) solid 3px",
    "rgb(156, 163, 175) dashed 2px",
  ]);
});

it("shows a tooltip with the locator text under every box", async () => {
  await show("selection", el("b"), el("c"));
  await frames();

  const tooltips = [
    ...(glassRoot?.querySelectorAll("x-pw-tooltip") ?? []),
  ] as HTMLElement[];
  expect(tooltips.map((tooltip) => tooltip.textContent)).toEqual([
    "locator('ayme-highlight=selection') [1 of 2]",
    "locator('ayme-highlight=selection') [2 of 2]",
  ]);
  expect(tooltips.every((tooltip) => tooltip.offsetWidth > 0)).toBe(true);
});

it("follows scrolling, resizing and layout changes", async () => {
  await show("selection", el("b"));
  await frames();
  expect(boxes().map(box)).toEqual([rect(el("b"))]);

  window.scrollTo(0, 50);
  await frames();
  expect(boxes().map(box)).toEqual([rect(el("b"))]);

  el("b").style.width = "220px";
  await frames();
  expect(boxes().map(box)).toEqual([rect(el("b"))]);

  host.prepend(
    Object.assign(document.createElement("div"), { style: "height: 40px" })
  );
  await frames();
  expect(boxes().map(box)).toEqual([rect(el("b"))]);

  await vitestPage.viewport(900, 600);
  await frames();
  expect(boxes().map(box)).toEqual([rect(el("b"))]);
  await vitestPage.viewport(1280, 800);
});

it("follows the layer's element set as it changes, and drops removed elements", async () => {
  await show("selection", el("a"));
  await frames();
  layers.selection = [el("b"), el("c")];
  await frames();
  expect(boxes().map(box)).toEqual([el("b"), el("c")].map(rect));

  el("c").remove();
  await frames();
  expect(boxes().map(box)).toEqual([rect(el("b"))]);
});

it("draws an element scrolled out of its scroll container where the host outline was clipped", async () => {
  await show("hover", el("inner"));
  await frames();
  const scroller = el("scroller").getBoundingClientRect();
  const [drawn] = boxes();
  // The element sits below the container's visible area: the overlay box
  // is drawn there anyway, over whatever is below the container.
  expect(drawn.y).toBeGreaterThan(scroller.bottom);
});

it("hides one layer, then the whole pane", async () => {
  const hover = await show("hover", el("a"));
  await show("selection", el("b"));
  await frames();
  expect(boxes()).toHaveLength(2);

  await hover.dispose();
  await frames();
  expect(boxes().map(box)).toEqual([rect(el("b"))]);

  await page.locator("ayme-highlight=selection").hideHighlight();
  await frames();
  expect(boxes()).toEqual([]);
  // The pane stays until page.hideHighlight().
  expect(glass()).not.toBeNull();

  await page.hideHighlight();
  expect(glass()).toBeNull();
});

it("shares one pane across pages: another page's hideHighlight() clears it", async () => {
  await show("selection", el("b"));
  await frames();
  await createPage().hideHighlight();
  expect(glass()).toBeNull();
});

it("re-queries every frame while any highlight is shown", async () => {
  await show("selection", el("b"));
  await frames(2);
  engineQueries = 0;
  await frames(30);
  expect(engineQueries).toBeGreaterThanOrEqual(28);
  await page.hideHighlight();
  engineQueries = 0;
  await frames(10);
  expect(engineQueries).toBe(0);
});

it("stays out of pointer hit-testing", async () => {
  await show("selection", el("b"));
  await frames();
  const r = el("b").getBoundingClientRect();
  expect(document.elementFromPoint(r.x + 5, r.y + 5)).toBe(el("b"));
});

it("is outside <body>: the body's mutations and ARIA snapshot don't see it; <html>'s child list does", async () => {
  const bodyRecords: MutationRecord[] = [];
  const htmlRecords: MutationRecord[] = [];
  const bodyObserver = new MutationObserver((r) => bodyRecords.push(...r));
  const htmlObserver = new MutationObserver((r) => htmlRecords.push(...r));
  bodyObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
  });
  htmlObserver.observe(document.documentElement, { childList: true });

  await show("selection", el("b"));
  await frames();
  await new Promise((r) => setTimeout(r));
  bodyObserver.disconnect();
  htmlObserver.disconnect();

  expect(bodyRecords).toEqual([]);
  expect(
    htmlRecords.flatMap((r) => [...r.addedNodes].map((n) => n.nodeName))
  ).toContain("X-PW-GLASS");
  expect(captureAriaSnapshot(document.body).fullText).not.toContain("locator(");
  expect(captureAriaSnapshot(document.documentElement).fullText).not.toContain(
    "locator("
  );
});

it("is over a popover opened before it, and under one opened after", async () => {
  // An opaque popover covering element B and its outline.
  const cover = document.createElement("div");
  cover.popover = "manual";
  const r = el("b").getBoundingClientRect();
  cover.style.cssText = `position: fixed; inset: auto; margin: 0; padding: 0; border: 0; background: white; left: ${r.left - 20}px; top: ${r.top - 20}px; width: ${r.width + 40}px; height: ${r.height + 40}px`;
  document.body.append(cover);

  cover.showPopover();
  await show("selection", el("b"));
  await frames();
  expect(await outlineAt(el("b"))).toBe("overlay on top");
  cover.hidePopover();
  await page.hideHighlight();

  await show("selection", el("b"));
  await frames();
  cover.showPopover();
  await frames();
  expect(await outlineAt(el("b"))).toBe("covered");
  cover.remove();
});

/** Whether the overlay outline shows at an element's edge, read from a screenshot. */
async function outlineAt(element: Element) {
  const r = element.getBoundingClientRect();
  // Just outside the element, on the outline (outline-offset 3px, width 3px).
  const x = Math.round(r.right + 4);
  const y = Math.round(r.top + r.height / 2);
  const shot = await vitestPage.screenshot({ base64: true, save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${shot}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const scale = image.width / window.innerWidth;
  const [red, green, blue] = context.getImageData(
    x * scale,
    y * scale,
    1,
    1
  ).data;
  const isOutline =
    Math.abs(red - 217) < 30 &&
    Math.abs(green - 164) < 30 &&
    Math.abs(blue - 65) < 30;
  return isOutline ? "overlay on top" : "covered";
}

it("registering another engine clears active highlights", async () => {
  await show("selection", el("b"));
  await frames();
  await selectors.register(
    "ayme-probe-other",
    `({ queryAll: () => [], query: () => null })`
  );
  // The next lite call recreates the injected script and hides the old pane.
  await show("hover", el("a"));
  await frames();
  expect(boxes().map(box)).toEqual([rect(el("a"))]);
});

it("looks like this (screenshot for the write-up)", async () => {
  await show("hover", el("a"));
  await show("selection", el("b"), el("c"));
  await show("unusable", el("inner"));
  await frames();
  await vitestPage.screenshot({ path: "__screenshots__/overlay-probe.png" });
});
