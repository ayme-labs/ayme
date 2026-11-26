import { SETTLED_PAGE_DEADLINE_MS } from "@ayme-dev/core/structural-observation";

import { askPresence } from "./pomPredicates";

/** How often a Run asks the returned Page Object's presence predicate again while it waits. */
const PRESENCE_ASK_INTERVAL_MS = 50;

/**
 * Package-internal: the presence wait (ADR-0067). Called once a Page Object
 * Action has answered, it resolves once the Page Object the action returns,
 * `returned`, is present, or at the Settled Page deadline counted from the
 * call. That one deadline covers the action returning, which an action
 * that answered at the start of a full load may still be about to do, and
 * the asks of the presence predicate after it. Only a presence predicate
 * the returned object's model declares or inherits is waited for: any other
 * value, nothing, or a rejection gets no wait.
 */
export async function waitForReturnedPageObject(
  returned: Promise<unknown>
): Promise<void> {
  const deadline = Date.now() + SETTLED_PAGE_DEADLINE_MS;
  const pageObject = await within(
    returned.catch(() => undefined),
    SETTLED_PAGE_DEADLINE_MS
  );
  if (typeof pageObject !== "object" || pageObject === null) return;
  for (;;) {
    // Undefined when the model declares and inherits no presence predicate.
    if ((await askPresence(pageObject)).present !== false) return;
    const left = deadline - Date.now();
    if (left <= 0) return;
    await sleep(Math.min(PRESENCE_ASK_INTERVAL_MS, left));
  }
}

/** What `promise` resolves to within `ms`, else undefined. */
async function within<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
