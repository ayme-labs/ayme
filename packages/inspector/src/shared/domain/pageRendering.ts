/**
 * Marks an element that renders the page's structure: the Structure lens's
 * tree and the search results, whose entries carry refs, and `fill_form`'s
 * rows, one per field on the page. A page dogfooding
 * the Inspector keeps them out of the structure they render, or each look at
 * the page would feed the previous one back in.
 */
export const INSPECTOR_PAGE_RENDERING_ATTRIBUTE =
  "data-ayme-inspector-page-rendering";
