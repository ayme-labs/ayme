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
 * Draws the recorder's own highlight over a box of the top document, in
 * place of the one drawn before, or takes it away when `box` is null. It is
 * not part of the page: hidden from the page's structure and from every
 * input, and drawn in a closed shadow root.
 */
export function drawHighlight(box: HighlightBox | null): void {
  const name = "ayme-recorder-highlight";
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
