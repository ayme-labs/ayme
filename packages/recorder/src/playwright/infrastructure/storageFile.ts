/** A storage state as a file holds it: a JSON object, as Playwright writes
 * one, with its cookies and origins. */
export type StorageStateObject = Record<string, unknown>;

/**
 * The storage state in the text of a `--load-storage` file. Anything but a
 * JSON object is none: Playwright would take a string for the path of
 * another file, and null for no storage state at all. Throws with what the
 * file holds instead, for a person.
 */
export function storageStateIn(text: string): StorageStateObject {
  const held: unknown = JSON.parse(text);
  if (typeof held === "object" && held !== null && !Array.isArray(held))
    return held as StorageStateObject;
  throw new Error(`it holds ${kindOf(held)}, not a storage state object.`);
}

/** What a JSON value is, in a person's words. */
const kindOf = (value: unknown) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "an array"
      : `a ${typeof value}`;
