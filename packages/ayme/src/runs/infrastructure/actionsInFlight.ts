// The runtime's page actions now running in each document, so that a look at
// the document can wait for them: a look holds the main thread for as long as
// it reads the page, and an action needs that thread for the animation frames
// that tell it its element is stable, within its timeout. Keyed by the
// document, whose main thread they share: the session's Page and the Page
// that hosts the document's in-page module are not the same object.

type InFlight = { running: number; waiting: (() => void)[] };

const inFlight = new WeakMap<Document, InFlight>();

function of(currentDocument: Document): InFlight {
  let found = inFlight.get(currentDocument);
  if (!found)
    inFlight.set(currentDocument, (found = { running: 0, waiting: [] }));
  return found;
}

/**
 * Runs `action` in `currentDocument`, counting it as running until it returns
 * or settles.
 */
export function whileActing<T>(currentDocument: Document, action: () => T): T {
  const actions = of(currentDocument);
  const ended = () => {
    actions.running -= 1;
    if (actions.running > 0) return;
    const settled = actions.waiting;
    actions.waiting = [];
    for (const resolve of settled) resolve();
  };
  actions.running += 1;
  let result: T;
  try {
    result = action();
  } catch (error) {
    ended();
    throw error;
  }
  if (result instanceof Promise) return result.finally(ended) as T;
  ended();
  return result;
}

/**
 * Resolves once no action is running in `currentDocument`, at once when none
 * is. Each action ends within its own timeout.
 */
export function actionsSettled(currentDocument: Document): Promise<void> {
  const actions = of(currentDocument);
  if (actions.running === 0) return Promise.resolve();
  return new Promise((resolve) => actions.waiting.push(resolve));
}
