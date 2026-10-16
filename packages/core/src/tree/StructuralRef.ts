import { AriaRefSchema, type AriaRef } from "./StructuralTypes";

/**
 * The grammar of a Structural Ref, in one place. A real ref is Playwright's
 * `e<number>`; a synthetic ref is Ayme's `s_<word>` (`s_root`, `s_1`, …),
 * minted for a node Playwright's snapshot gave no ref, such as a Page Object
 * Root. The browser Page acts on either through the `ayme-ref=…` selector,
 * which Ayme's own selector engine resolves from the current capture
 * (ADR-0038).
 */
const REAL_REF = /e\d+/;
const REF = new RegExp(`${REAL_REF.source}|s_\\w+`);
const WHOLE_REF = new RegExp(`^(?:${REF.source})$`);
// The whole selector, bare or as the one argument of a `locator(…)` string.
const SELECTOR_REF = new RegExp(
  `^(?:locator\\(['"])?ayme-ref=(${REF.source})(?:['"]\\))?$`
);
const SYNTHETIC_PREFIX = "s_";
// A snapshot names a node's ref in the attribute `[ref=e5]`.
const REF_ATTRIBUTE = "ref=";
// A real ref as Playwright MCP writes it, `[ref=e5]` or `ref=e5`, or with a
// capital `E` or surrounding spaces.
const REF_WRITTEN_OTHERWISE = new RegExp(
  `^\\s*(?:\\[\\s*ref\\s*=\\s*(${REAL_REF.source})\\s*\\]|(?:ref\\s*=\\s*)?(${REAL_REF.source}))\\s*$`,
  "i"
);

/** The Structural Ref `text` is, or undefined when it is not one. */
export function parseStructuralRef(text: string): AriaRef | undefined {
  return WHOLE_REF.test(text) ? AriaRefSchema.parse(text) : undefined;
}

/**
 * The real ref `text` writes another way, read leniently: `[ref=e5]`,
 * `ref=e5`, `E5` and ` e5 ` all read as `e5`. Undefined when `text` writes
 * no ref, such as a selector.
 */
export function refWrittenOtherwise(text: string): AriaRef | undefined {
  const match = REF_WRITTEN_OTHERWISE.exec(text);
  const ref = match?.[1] ?? match?.[2];
  return ref === undefined ? undefined : AriaRefSchema.parse(ref.toLowerCase());
}

/** Whether `ref` is synthetic: minted by Ayme, not by Playwright's snapshot. */
export function isSyntheticRef(ref: AriaRef): boolean {
  return ref.startsWith(SYNTHETIC_PREFIX);
}

/**
 * The synthetic ref named `name`: `syntheticRef("root")` is `s_root`. Throws
 * when `name` cannot complete one, such as an empty name or one with spaces.
 */
export function syntheticRef(name: string | number): AriaRef {
  const ref = parseStructuralRef(`${SYNTHETIC_PREFIX}${name}`);
  if (ref === undefined)
    throw new Error(`"${name}" cannot name a synthetic Structural Ref.`);
  return ref;
}

/**
 * Mints synthetic refs named `name` and a counter (`s_<name>1`, …), skipping
 * any that occur in `text`, so no allocated ref collides with one `text`
 * already names.
 */
export function syntheticRefsAbsentFrom(
  text: string,
  name: string
): { create(): AriaRef } {
  let counter = 0;
  return {
    create() {
      let ref: AriaRef;
      do ref = syntheticRef(`${name}${++counter}`);
      while (text.includes(ref));
      return ref;
    },
  };
}

/** The ref a fragment that wraps several snapshot roots carries. */
export const SYNTHETIC_ROOT_REF = syntheticRef("root");

/** The selector the browser Page resolves to the element `ref` names. */
export function selectorForRef(ref: AriaRef): string {
  return `ayme-ref=${ref}`;
}

/**
 * The Structural Ref a selector, or a locator string made of one selector,
 * addresses through `ayme-ref=…`; undefined when it addresses its element
 * another way, including a selector that merely contains the text.
 */
export function refFromSelector(selector: string): AriaRef | undefined {
  const ref = SELECTOR_REF.exec(selector)?.[1];
  return ref === undefined ? undefined : AriaRefSchema.parse(ref);
}

/** The snapshot attribute that names `ref`, without its brackets: `ref=e5`. */
export function refAttribute(ref: AriaRef): string {
  return `${REF_ATTRIBUTE}${ref}`;
}

/**
 * The ref a snapshot attribute names, read from the attribute's content
 * (`ref=e5`), or undefined when the attribute is another one. The value is
 * taken as the snapshot wrote it: a snapshot may name refs no tool acts on.
 */
export function refFromAttribute(content: string): string | undefined {
  return content.startsWith(REF_ATTRIBUTE)
    ? content.slice(REF_ATTRIBUTE.length)
    : undefined;
}
