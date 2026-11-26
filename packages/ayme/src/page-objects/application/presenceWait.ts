import { SETTLED_PAGE_DEADLINE_MS } from "@ayme-dev/core/structural-observation";

import { askPresence } from "./pomPredicates";

/** How often a Run asks the returned Page Object's presence predicate again while it waits. */
const PRESENCE_ASK_INTERVAL_MS = 50;

/**
 * Package-internal: the presence wait (ADR-0067). Called once a Page Object
 * Action has returned `pageObject`, it resolves once that Page Object is
 * present, or at the Settled Page deadline counted from the call. Only a
 * presence predicate the returned object's model declares or inherits is
 * waited for: any other value or nothing gets no wait. Resolves with
 * whether the returned Page Object's own presence predicate found it
 * present.
 */
export async function waitForReturnedPageObject(
  pageObject: unknown
): Promise<boolean> {
  const deadline = Date.now() + SETTLED_PAGE_DEADLINE_MS;
  if (typeof pageObject !== "object" || pageObject === null) return false;
  for (;;) {
    // Undefined when the model declares and inherits no presence predicate.
    const { present } = await askPresence(pageObject);
    if (present !== false) return present === true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await sleep(Math.min(PRESENCE_ASK_INTERVAL_MS, left));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const arrived = new WeakSet<object>();

/**
 * Package-internal: whether the Page Object the action that answered
 * `result` returned was found present in the document a full load the
 * action started brought, as only a Host that outlives a full load waits
 * for it.
 */
export const arrivedAfterLoad = (result: unknown): boolean =>
  typeof result === "object" && result !== null && arrived.has(result);

/** Package-internal: `result`'s returned Page Object arrived after its
 * full load. */
export function markArrivedAfterLoad(result: object): void {
  arrived.add(result);
}
