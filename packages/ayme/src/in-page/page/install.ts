// Stryker disable all
// The in-page module's page part: what runs in the document. The build turns
// this file and everything it imports into one self-contained function,
// `installInPage` (build/inPageModule.ts), which a host runs in the page:
// Playwright Lite calls it, real Playwright sends its source. Nothing here may
// rely on state outside that function.

/** One document's identity: a new token is a new document. */
export type DocumentToken = string & { readonly __brand: "DocumentToken" };
/** One host, a side that drives the page through Playwright's Page. */
export type HostKey = string;

/** What a host learns when it binds: the document, and who installed its module. */
export type Bound = {
  document: DocumentToken;
  version: string;
  installedBy: HostKey;
  host: HostKey;
};

export type InstallArgument = {
  version: string;
  host: HostKey;
  /** The host's binding in this page, through which the module calls it. */
  binding: string;
};

export type InstallResult =
  { kind: "bound"; bound: Bound } | { kind: "version"; found: string };

/** The one module of a document, under a well-known symbol on its global. */
type Slot = {
  readonly version: string;
  readonly token: DocumentToken;
  readonly installedBy: HostKey;
  bind(host: HostKey, binding: string): Bound;
};

const slotKey = Symbol.for("ayme.inPage");

/**
 * Installs the document's in-page module, unless one is there already: then
 * it binds `host` to that one, of the same version, or answers the version it
 * found. A later host never installs, and nothing replaces the module.
 */
export function install({
  version,
  host,
  binding,
}: InstallArgument): InstallResult {
  const found = (globalThis as { [slotKey]?: Slot })[slotKey];
  if (found)
    return found.version === version
      ? { kind: "bound", bound: found.bind(host, binding) }
      : { kind: "version", found: found.version };
  const slot = createSlot(version, host);
  // Neither writable nor configurable, so no other copy can replace it.
  Object.defineProperty(globalThis, slotKey, { value: slot });
  return { kind: "bound", bound: slot.bind(host, binding) };
}

function createSlot(version: string, installedBy: HostKey): Slot {
  const token = mintToken();
  // Each bound host's binding, through which the module will call it.
  const bindings = new Map<HostKey, string>();
  return Object.freeze({
    version,
    token,
    installedBy,
    bind(host: HostKey, binding: string): Bound {
      bindings.set(host, binding);
      return { document: token, version, installedBy, host };
    },
  });
}

/** A random token; `crypto.randomUUID` needs a secure context, this does not. */
function mintToken(): DocumentToken {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  ) as DocumentToken;
}
