/** A style Playwright's `locator.highlight({ style })` takes. */
export type HighlightStyle = Record<string, string | number>;

// A highlight is Playwright's box over an element, an overlay the page's own
// elements are never marked for. Each has no fill, only an outline.
const outline = { background: "transparent", "outline-offset": "3px" };

/**
 * The highlights the Inspector and picking draw: `pinned` (solid) for a
 * selection, `hover` (dashed) for what the pointer is over, `unusable` (grey,
 * dashed) for an element picking cannot take.
 */
export const highlightStyles = {
  pinned: { ...outline, outline: "3px solid #d9a441" },
  hover: { ...outline, outline: "2px dashed #d9a441" },
  unusable: { ...outline, outline: "2px dashed #9ca3af" },
} as const satisfies Record<string, HighlightStyle>;
