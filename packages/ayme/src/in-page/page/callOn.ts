// Stryker disable all
// The small function a host sends to call the document's module on the
// elements a Locator matches, through `locator.evaluateAll`: the elements
// never leave the page. Like `call`, built on its own into `callOnInPage`
// (build/inPageModule.ts), so it closes over nothing. It never installs the
// module: a host that needs one installs it and calls again.
import type { HostKey, Slot } from "./install";

/** The slot's methods a host calls on the elements a Locator matches. */
export type CallOnName =
  | "refs"
  | "cue"
  | "probe"
  | "mint"
  | "names"
  | "is"
  | "recommend"
  | "covered"
  | "match";

export type CallOnArgument = {
  version: string;
  host: HostKey;
  name: CallOnName;
  /** What the call needs besides the elements, such as a probe's label. */
  inputs?: unknown;
};

export type CallOnResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "missing"; matched: number }
  | { kind: "version"; found: string };

export async function callOn(
  elements: Element[],
  { version, host, name, inputs }: CallOnArgument
): Promise<CallOnResult<unknown>> {
  const slot = (globalThis as { [key: symbol]: Slot | undefined })[
    Symbol.for("ayme.inPage")
  ];
  if (!slot) return { kind: "missing", matched: elements.length };
  if (slot.version !== version) return { kind: "version", found: slot.version };
  return {
    kind: "ok",
    value: await (
      slot[name] as (
        host: HostKey,
        elements: Element[],
        inputs?: unknown
      ) => unknown
    )(host, elements, inputs),
  };
}
