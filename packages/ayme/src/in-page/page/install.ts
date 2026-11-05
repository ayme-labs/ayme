// Stryker disable all
// The in-page module's page part: what runs in the document. The build turns
// this file and everything it imports into one self-contained function,
// `installInPage` (build/inPageModule.ts), which a host runs in the page:
// Playwright Lite calls it, real Playwright sends its source. Nothing here may
// rely on state outside that function.
import { captureAriaSnapshot } from "virtual:ayme-aria-snapshot";

import type { Capture, DocumentToken, ReachMeasurement } from "../../shared";
import {
  createActions,
  type ActionInputs,
  type Begun,
  type LoadStarted,
  type Settled,
} from "./actions";
import { watchActivity } from "./activity";
import { createRefWorld, type ElementInputs } from "./capture";
import { watchFullLoads, watchSameDocumentNavigations } from "./navigation";
import { createReach } from "./reach";
import { showCue } from "./cue";
import { startPicking, type PickArguments, type PickNotice } from "./pick";

export type { Capture, DocumentToken, ReachMeasurement };
export type { ElementInputs } from "./capture";
export type { PickArguments, PickNotice } from "./pick";
export type { ActionInputs, Begun, Settled } from "./actions";

/** What a host asks to pick a ref: `id` names this picking in the notices it gets back. */
export type PickRequest = PickArguments & { id: string };

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
  | { kind: "bound"; bound: Bound; url: string }
  | { kind: "version"; found: string };

/**
 * What the module tells a bound host through its binding, with the
 * document's token: a same-document navigation, for its Visits, a full load
 * that ended one of its actions, or what the pointer is over in its picking.
 */
export type HostMessage =
  | { kind: "visit"; url: string }
  | LoadStarted
  | { kind: "pick"; id: string; notice: PickNotice };

/** What a host asks of the module about the reach of the element a ref names. */
export type ReachRequest = {
  ref: string;
  /**
   * `current`: reach as the layout stands, for offering the element.
   * `before-scroll` and `after-scroll`: the two parts of reach at the call
   * that clicks it, around the call's own scroll. `blocking`: only what
   * blocks every click and the focus.
   */
  stage: "current" | "before-scroll" | "after-scroll" | "blocking";
};

/** The module's answer to a `ReachRequest`; `gone` when the ref names no connected element. */
export type ReachAnswer =
  | { kind: "measured"; measurement: ReachMeasurement | "scroll" }
  | { kind: "blocking"; blocker?: string }
  | { kind: "gone" };

/** The reach of this document's elements, for a host in the document's own realm. */
export type Reach = ReturnType<typeof createReach>;

/** The one module of a document, under a well-known symbol on its global. */
export type Slot = {
  readonly version: string;
  readonly token: DocumentToken;
  readonly installedBy: HostKey;
  bind(host: HostKey, binding: string): Bound;
  /** A capture of the document for `host`, with the roots it hands in. */
  capture(host: HostKey, inputs?: ElementInputs): Capture;
  /** Reach (ADR-0041) of the element a ref names, for a host that sends refs. */
  measure(host: HostKey, request: ReachRequest): ReachAnswer;
  /**
   * Reach of elements, for a host in the document's own realm, such as the
   * browser runtime's, which holds them. Names what it finds by ref.
   */
  readonly reach: Reach;
  /** The before capture of an action of `host`, whose full-load watch it arms. */
  begin(host: HostKey, inputs?: ActionInputs): Promise<Begun>;
  /** The Settled Page after `host`'s `action` and its capture, or the load that ended it. */
  settle(
    host: HostKey,
    action: number,
    inputs?: ActionInputs
  ): Promise<Settled>;
  /** The Structural Ref each element has in the document, if it was ever captured. */
  refs(host: HostKey, elements: readonly Element[]): (string | undefined)[];
  /** The connected element under `root` that `ref` names: the `ayme-ref` engine's query. */
  queryRef(ref: string, root?: Node): Element[];
  /**
   * Transitional (#1182): the element `ref` names, connected or not, for the
   * browser runtime's lookups by ref until its consumers read the page
   * through Locators.
   */
  elementOf(ref: string): Element | undefined;
  /**
   * Picks a ref by pointing at the document, for `host`: answers with the ref
   * clicked, or none when Esc or `cancelPick` ends it. The host hears what the
   * pointer is over, as `{ id, ...notice }`, through its binding.
   */
  pick(host: HostKey, request: PickRequest): Promise<string | undefined>;
  /** Ends `host`'s picking `id`, if it is on, as Esc does. */
  cancelPick(host: HostKey, id: string): void;
  /** Shows Demo Mode's click cue on the one element `matched` holds, and answers when it has gone. */
  cue(host: HostKey, matched: Element[]): Promise<void>;
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
      ? { kind: "bound", bound: found.bind(host, binding), url: location.href }
      : { kind: "version", found: found.version };
  const slot = createSlot(version, host);
  // Neither writable nor configurable, so no other copy can replace it.
  Object.defineProperty(globalThis, slotKey, { value: slot });
  return {
    kind: "bound",
    bound: slot.bind(host, binding),
    url: location.href,
  };
}

function createSlot(version: string, installedBy: HostKey): Slot {
  const token = mintToken();
  // Each bound host's binding, through which the module calls it.
  const bindings = new Map<HostKey, string>();
  // The document's one ref world: its marks, counters and ref map.
  const refs = createRefWorld(captureAriaSnapshot);
  const reach = createReach(refs.nameOf);
  // Each host's picking that is on, to end it.
  const pickings = new Map<string, () => void>();
  // Pickings cancelled before they started: the cancel can arrive first.
  const cancelled = new Set<string>();
  const capture = (_host: HostKey, inputs?: ElementInputs): Capture => ({
    document: token,
    url: location.href,
    ...refs.capture(document.body, inputs),
  });

  /** Tells `host` of `message`, if it is still bound and listening. */
  function tell(host: HostKey, message: HostMessage): void {
    const binding = bindings.get(host);
    const listener =
      binding && (globalThis as Record<string, unknown>)[binding];
    if (typeof listener !== "function") return;
    try {
      void Promise.resolve(listener(token, message)).catch(() => {});
    } catch {
      // A host that is gone hears nothing.
    }
  }

  // The watchers are the document's own: a new document arms new ones.
  const actions = createActions({
    activity: watchActivity(document),
    capture,
    tell,
  });
  watchSameDocumentNavigations(window, () => {
    for (const host of bindings.keys())
      tell(host, { kind: "visit", url: location.href });
  });
  watchFullLoads(window, actions.loadStarted);

  return Object.freeze({
    version,
    token,
    installedBy,
    bind(host: HostKey, binding: string): Bound {
      bindings.set(host, binding);
      return { document: token, version, installedBy, host };
    },
    capture,
    measure: (_host: HostKey, { ref, stage }: ReachRequest): ReachAnswer => {
      const element = refs.elementOf(ref);
      if (!element?.isConnected) return { kind: "gone" };
      if (stage === "blocking")
        return { kind: "blocking", blocker: reach.blockingAncestor(element) };
      return {
        kind: "measured",
        measurement:
          stage === "current"
            ? reach.measure(element)
            : stage === "before-scroll"
              ? reach.measureBeforeScroll(element)
              : reach.measureAfterScroll(element),
      };
    },
    reach,
    begin: actions.begin,
    settle: actions.settle,
    refs: (_host: HostKey, elements: readonly Element[]) =>
      elements.map(refs.lastRefOf),
    queryRef: refs.queryRef,
    elementOf: refs.elementOf,
    pick(host: HostKey, { id, ...request }: PickRequest) {
      if (cancelled.delete(`${host}:${id}`)) return Promise.resolve(undefined);
      const picking = startPicking(request, refs.refOf, (notice) =>
        tell(host, { kind: "pick", id, notice })
      );
      const key = `${host}:${id}`;
      pickings.set(key, picking.cancel);
      return picking.result.finally(() => pickings.delete(key));
    },
    cancelPick(host: HostKey, id: string) {
      const key = `${host}:${id}`;
      const cancel = pickings.get(key);
      if (cancel) cancel();
      else cancelled.add(key);
    },
    async cue(_host: HostKey, matched: Element[]) {
      if (matched.length === 1) await showCue(matched[0]!);
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
