// Test support for browser tests: the Structural Ref the in-page module has
// given the element a selector matches, after an unrecorded look at the page
// that names what it holds. Records nothing and moves no cursor.
import {
  AriaRefSchema,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";

import { selectors } from "@ayme-dev/playwright-lite";

import { inPage, registerAymeRef } from "../in-page";
import {
  lookAtPageStateForDocument,
  pageOfDocument,
} from "../page-state/infrastructure";

/** The refs of the elements `selectors` match, one each, after a look at the document. */
export async function refsOfSelectors(
  ...matching: string[]
): Promise<(AriaRef | undefined)[]> {
  await lookAtPageStateForDocument(document);
  const page = pageOfDocument(document);
  return Promise.all(
    matching.map(async (selector) => {
      const [ref] = await inPage(page).elements.refs(page.locator(selector));
      return ref === undefined ? undefined : AriaRefSchema.parse(ref);
    })
  );
}

/** What `read` makes of the element `ref` names now, read in the page. */
export async function readRef<T>(
  ref: string,
  read: (element: Element) => T
): Promise<T> {
  await registerAymeRef(selectors);
  return pageOfDocument(document).locator(`ayme-ref=${ref}`).evaluate(read);
}

let handed = 0;

/**
 * The element `ref` names now, for a test to compare with one it holds: the
 * test shares the page's realm, so the page can hand it the element itself,
 * under a key of its own so that calls in flight together do not meet.
 */
export async function elementOfRef(ref: string): Promise<Element | undefined> {
  const page = pageOfDocument(document);
  await registerAymeRef(selectors);
  const locator = page.locator(`ayme-ref=${ref}`);
  if ((await locator.count()) !== 1) return undefined;
  const key = `ayme.test.foundElement.${++handed}`;
  await locator.evaluate((element, handedKey) => {
    (globalThis as { [key: symbol]: unknown })[Symbol.for(handedKey)] = element;
  }, key);
  const holder = globalThis as { [key: symbol]: unknown };
  const element = holder[Symbol.for(key)] as Element;
  delete holder[Symbol.for(key)];
  return element;
}
