// Spike: what a Page Object Action returned, kept by the answer its Run
// gave, so the agent tools of a session that outlives a full load can wait
// for the Page Object an action led to (the `ayme` command's background
// process). Nothing else reads it.

const returnedBy = new WeakMap<object, Promise<object | undefined>>();

/**
 * Spike: keeps, for the action answer `answer`, the object `returned`
 * resolves to when it is one other than `self`, the Page Object the action
 * ran on; undefined for anything else or `self`. `returned` never rejects.
 */
export function keepReturnedObject(
  answer: object,
  returned: Promise<unknown>,
  self: object
): void {
  returnedBy.set(
    answer,
    returned.then((value) =>
      typeof value === "object" && value !== null && value !== self
        ? value
        : undefined
    )
  );
}

/** Spike: the object the action that answered `answer` returned, as `keepReturnedObject` kept it. */
export function returnedObjectOf(
  answer: unknown
): Promise<object | undefined> | undefined {
  return typeof answer === "object" && answer !== null
    ? returnedBy.get(answer)
    : undefined;
}
