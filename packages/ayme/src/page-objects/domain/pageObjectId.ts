declare const pageObjectIdBrand: unique symbol;

/**
 * The id of a Page Object of a rooted class, written `po<n>`: what a caller
 * names the Page Object by when it calls one of its Page Object Tools. It is
 * not a Structural Ref, which names an element, and neither is assignable
 * to the other.
 */
export type PageObjectId = string & {
  readonly [pageObjectIdBrand]: "PageObjectId";
};

const PAGE_OBJECT_ID = /^po[1-9]\d*$/;

/** `text` as a Page Object id, when it is written as one: `po<n>`. */
export function parsePageObjectId(text: unknown): PageObjectId | undefined {
  return typeof text === "string" && PAGE_OBJECT_ID.test(text)
    ? (text as PageObjectId)
    : undefined;
}

/** The `n`th Page Object id a page gives out, from 1. */
export function pageObjectIdOf(n: number): PageObjectId {
  return `po${n}` as PageObjectId;
}
