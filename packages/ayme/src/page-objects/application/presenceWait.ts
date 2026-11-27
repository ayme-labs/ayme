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
    // Each ask gets only the time left, so a predicate that never answers
    // cannot hold the Run past the deadline. Undefined when the model
    // declares and inherits no presence predicate.
    const answer = await within(askPresence(pageObject), deadline - Date.now());
    if (answer === TIMED_OUT) return false;
    if (answer.present !== false) return answer.present === true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await sleep(Math.min(PRESENCE_ASK_INTERVAL_MS, left));
  }
}

const TIMED_OUT = Symbol("timed out");

/** What `promise` resolves to within `ms`, else TIMED_OUT. */
async function within<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
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
