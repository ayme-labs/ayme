// Stryker disable all
// The small function a host sends to call the document's module on the
// elements a Locator matches (`locator.evaluateAll`): like `call`, built on its
// own into `callOnInPage` (build/inPageModule.ts), so it closes over nothing.
import type { Slot } from "./install";

/** What a host calls on matched elements: one of the slot's methods. */
export type CallOnArgument = { version: string; host: string; name: "cue" };

export async function callOn(
  elements: Element[],
  { version, host, name }: CallOnArgument
): Promise<
  { kind: "ok" } | { kind: "missing" } | { kind: "version"; found: string }
> {
  const slot = (globalThis as { [key: symbol]: Slot | undefined })[
    Symbol.for("ayme.inPage")
  ];
  if (!slot) return { kind: "missing" };
  if (slot.version !== version) return { kind: "version", found: slot.version };
  await slot[name](host, elements);
  return { kind: "ok" };
}
