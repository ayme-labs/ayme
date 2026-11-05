// Stryker disable all
// The small function a host sends for every call after the install: it
// reaches the document's module through its slot, and answers whether the
// module is there and of the host's version. Built on its own into
// `callInPage` (build/inPageModule.ts), so it closes over nothing.
import type { DocumentToken } from "../../shared";
import type { HostKey, Slot } from "./install";

/** The slot's methods a host calls through `callInPage`. */
export type CallName =
  "capture" | "measure" | "pick" | "cancelPick" | "begin" | "settle";

/** What a host calls: one of the slot's methods, with its arguments. */
export type CallArgument = {
  version: string;
  host: HostKey;
  /** The host's binding, which a document new to the host binds. */
  binding: string;
  /** The document the host last bound; any other is new to it. */
  token?: DocumentToken;
  /** Whether the call runs only in `token`'s document, as an action's settle. */
  strict?: boolean;
  name: CallName;
  args: unknown[];
};

export type CallResult<T> =
  | {
      kind: "ok";
      value: T;
      /** The document the call bound the host to, new to it, and its URL then. */
      entered?: { document: DocumentToken; url: string };
    }
  | { kind: "missing" }
  | { kind: "version"; found: string }
  | { kind: "document"; token: DocumentToken };

export async function call({
  version,
  host,
  binding,
  token,
  strict,
  name,
  args,
}: CallArgument): Promise<CallResult<unknown>> {
  const slot = (globalThis as { [key: symbol]: Slot | undefined })[
    Symbol.for("ayme.inPage")
  ];
  if (!slot) return { kind: "missing" };
  if (slot.version !== version) return { kind: "version", found: slot.version };
  const method = slot[name] as (host: HostKey, ...args: unknown[]) => unknown;
  if (slot.token === token)
    return { kind: "ok", value: await method(host, ...args) };
  // An action's settle never crosses into another document.
  if (strict) return { kind: "document", token: slot.token };
  slot.bind(host, binding);
  const entered = { document: slot.token, url: location.href };
  return { kind: "ok", value: await method(host, ...args), entered };
}
