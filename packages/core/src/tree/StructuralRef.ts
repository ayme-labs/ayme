import { AriaRefSchema, type AriaRef } from "./StructuralTypes";

/**
 * The grammar of a Structural Ref, in one place. A real ref is Playwright's
 * `e<number>`, a handle the browser Page can act on through the
 * `aria-ref=…` selector. A synthetic ref is Ayme's `s_<word>` (`s_root`,
 * `s_1`, …): it names a node that exists only in the observation, so no
 * selector reaches it and no tool acts on it.
 */
const REF = /e\d+|s_\w+/;
const WHOLE_REF = new RegExp(`^(?:${REF.source})$`);
// The whole selector, bare or as the one argument of a `locator(…)` string.
const SELECTOR_REF = new RegExp(
  `^(?:locator\\(['"])?aria-ref=(${REF.source})(?:['"]\\))?$`
);
const SYNTHETIC_PREFIX = "s_";

/** The Structural Ref `text` is, or undefined when it is not one. */
export function parseStructuralRef(text: string): AriaRef | undefined {
  return WHOLE_REF.test(text) ? AriaRefSchema.parse(text) : undefined;
}

/** Whether `ref` is synthetic: observation-only, with no browser handle. */
export function isSyntheticRef(ref: AriaRef): boolean {
  return ref.startsWith(SYNTHETIC_PREFIX);
}

/** The selector the browser Page resolves to the element `ref` names. */
export function selectorForRef(ref: AriaRef): string {
  return `aria-ref=${ref}`;
}

/**
 * The Structural Ref a selector, or a locator string made of one selector,
 * addresses through `aria-ref=…`; undefined when it addresses its element
 * another way, including a selector that merely contains the text.
 */
export function refFromSelector(selector: string): AriaRef | undefined {
  const ref = SELECTOR_REF.exec(selector)?.[1];
  return ref === undefined ? undefined : AriaRefSchema.parse(ref);
}
