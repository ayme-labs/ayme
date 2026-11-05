// Stryker disable all
// The small function a host sends for every call after the install: it
// reaches the document's module through its slot, and answers whether the
// module is there and of the host's version. Built on its own into
// `callInPage` (build/inPageModule.ts), so it closes over nothing.
import type { Slot } from "./install";

/** What a host calls: one of the slot's methods, with its arguments. */
export type CallArgument = {
  version: string;
  host: string;
  name: "capture" | "measure";
  inputs?: unknown;
};

export type CallResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "missing" }
  | { kind: "version"; found: string };

export function call({
  version,
  host,
  name,
  inputs,
}: CallArgument): CallResult<unknown> {
  const slot = (globalThis as { [key: symbol]: Slot | undefined })[
    Symbol.for("ayme.inPage")
  ];
  if (!slot) return { kind: "missing" };
  if (slot.version !== version) return { kind: "version", found: slot.version };
  return { kind: "ok", value: slot[name](host, inputs as never) };
}
