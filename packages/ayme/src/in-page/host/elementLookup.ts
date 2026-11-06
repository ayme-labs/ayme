// Transitional (#1182): the browser runtime's lookup of an element by its
// Structural Ref, read from the document's in-page module directly, in the
// realm this bundle runs in. Reach, the element tools, the Goal Loop's
// questions and the Inspector still hold elements; once they read the page
// through Locators, #1182 removes this file and its lint exception.
import type { Slot } from "../page/install";

/**
 * The element `ref` names in this realm's document, if its module minted the
 * ref and it still names it.
 */
export function elementOfRef(ref: string): Element | undefined {
  return (globalThis as { [key: symbol]: Slot | undefined })[
    Symbol.for("ayme.inPage")
  ]?.elementOf(ref);
}

/**
 * The element `ref` named in this realm's document at any time, if its
 * module minted the ref: a root's ref from a probe outlives the capture that
 * marks the root.
 */
export function elementEverNamed(ref: string): Element | undefined {
  return (globalThis as { [key: symbol]: Slot | undefined })[
    Symbol.for("ayme.inPage")
  ]?.elementEverNamed(ref);
}
