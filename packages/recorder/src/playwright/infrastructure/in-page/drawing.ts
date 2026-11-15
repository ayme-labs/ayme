/// <reference lib="dom" />

// What the adapter draws, or keeps from being drawn, in a recorded page.
// Each function is sent to the page as its own text, so it uses nothing from
// outside itself (docs/testing.md#code-a-real-browser-runs).

/**
 * Takes away the mark Playwright's recorder leaves on the body when it
 * picks an element (`data-pw-cursor`, a private part of Playwright), as soon
 * as it is put there. Left there, it makes every element look clickable,
 * and the page's structure loses its marks of what is clickable.
 */
export function keepCursorsAsTheyAre(): void {
  const mark = "data-pw-cursor";
  const take = () => document.body?.removeAttribute(mark);
  new MutationObserver(take).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: [mark],
  });
  take();
}

/** Hides what Playwright's recorder draws over the page. */
export function hidePlaywrightOverlay(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync("x-pw-glass { display: none !important; }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

/** Where the highlight is drawn, in the top document's viewport. */
export type HighlightBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Draws the recorder's own outline, under the host element `name`, over a
 * box of its document's viewport, in place of the one drawn there before,
 * or takes it away when `box` is null. It is not part of the page: hidden
 * from the page's structure and from every input, and drawn in a closed
 * shadow root. The highlight and the outline while picking share it, so
 * they look the same.
 */
export function outline(name: string, box: HighlightBox | null): void {
  document.querySelector(name)?.remove();
  if (!box) return;
  const host = document.createElement(name);
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position: fixed",
    `left: ${box.x}px`,
    `top: ${box.y}px`,
    `width: ${box.width}px`,
    `height: ${box.height}px`,
    "margin: 0",
    "padding: 0",
    "border: 0",
    "pointer-events: none",
    "z-index: 2147483647",
    "display: block",
  ].join(";");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML =
    "<div style='box-sizing: border-box; width: 100%; height: 100%; border: 2px solid #e5484d; border-radius: 3px; background: rgb(229 72 77 / 15%)'></div>";
  document.documentElement.append(host);
}

type Outline = { readonly outline: typeof outline };
type Picking = Outline & {
  readonly recordersOwn: (localName: string) => boolean;
};

/** Draws the recorder's own highlight over a box of the top document, or
 * takes it away when `box` is null. */
export function drawHighlight(box: HighlightBox | null, rules: Outline): void {
  rules.outline("ayme-recorder-highlight", box);
}

/**
 * While Playwright picks the element whose visibility is asserted, outlines
 * the element under the mouse in this document, the one picking would pick:
 * the deepest under the mouse, as Playwright takes it, through open shadow
 * roots, never the recorder's own elements. The picking click, after which
 * Playwright picks no more, and leaving picking take it away; so does the
 * mouse leaving the document.
 */
export function followPicking(on: boolean, rules: Picking): void {
  const name = "ayme-recorder-picking";
  const self = window as unknown as { __aymeRecorderPicking?: () => void };
  self.__aymeRecorderPicking?.();
  if (!on) return;
  const follow = (event: MouseEvent) => {
    const under = event.composedPath()[0];
    const shown =
      under instanceof Element && !rules.recordersOwn(under.localName);
    rules.outline(name, shown ? under.getBoundingClientRect() : null);
  };
  const hide = () => rules.outline(name, null);
  const stop = () => {
    window.removeEventListener("mousemove", follow, true);
    window.removeEventListener("click", stop, true);
    document.documentElement.removeEventListener("mouseleave", hide);
    hide();
    delete self.__aymeRecorderPicking;
  };
  window.addEventListener("mousemove", follow, true);
  window.addEventListener("click", stop, true);
  document.documentElement.addEventListener("mouseleave", hide);
  self.__aymeRecorderPicking = stop;
}
