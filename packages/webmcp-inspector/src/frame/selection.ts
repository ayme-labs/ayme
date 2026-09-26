/**
 * What the person has selected. One selection is shared by the navigator,
 * the detail pane and Runs. Each lens owns the kinds it selects.
 */
export type Selection =
  /** The page as a whole. */
  | { kind: "page" }
  /** A Page Object on the page, by path, e.g. "ListPage.items[1]". */
  | { kind: "object"; path: string }
  /** A Page Object Model, by class name. */
  | { kind: "model"; className: string }
  /** A node of the page's structure, by ref. */
  | { kind: "node"; ref: string }
  /** A published tool, by name. */
  | { kind: "tool"; name: string };

export const pageSelection: Selection = { kind: "page" };

export function sameSelection(a: Selection, b: Selection) {
  return JSON.stringify(a) === JSON.stringify(b);
}
