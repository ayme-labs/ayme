// Stryker disable all
// The in-page module's page part: what runs in the document. The build turns
// this file and everything it imports into one self-contained function,
// `installInPage` (build/inPageModule.ts), which a host runs in the page:
// Playwright Lite calls it, real Playwright sends its source. Nothing here may
// rely on state outside that function.
import {
  asLocator,
  captureAriaSnapshot,
  generateSelector,
  InjectedScript,
} from "virtual:ayme-aria-snapshot";

import type {
  Capture,
  DocumentToken,
  FilterData,
  Predicate,
  ReachMeasurement,
} from "../../shared";
import {
  createActions,
  type ActionInputs,
  type Begun,
  type LoadStarted,
  type Settled,
} from "./actions";
import { watchActivity } from "./activity";
import { createRefWorld, type CaptureAsk, type ElementInputs } from "./capture";
import { watchFullLoads, watchSameDocumentNavigations } from "./navigation";
import { predicates } from "./predicates";
import { createReach } from "./reach";
import { showCue } from "./cue";
import { startPicking, type PickArguments, type PickNotice } from "./pick";
import { createRoots, type ProbeRequest, type RootState } from "./roots";
import { checkFilter, type FilterCheck } from "./filter";
import { createRecommender } from "./recommend";

export type { Capture, DocumentToken, Predicate, ReachMeasurement };
export type { CaptureAsk, ElementInputs } from "./capture";
export type { PickArguments, PickNotice } from "./pick";
export type { ActionInputs, Begun, Settled } from "./actions";
export type { ProbeRequest, RootState } from "./roots";
export type { FilterCheck } from "./filter";

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
 * that ended one of its actions, what the pointer is over in its picking, or,
 * to a host that watches, that the page may have changed, the `seq`th time.
 */
export type HostMessage =
  | { kind: "visit"; url: string }
  | { kind: "change"; seq: number }
  | LoadStarted
  | { kind: "pick"; id: string; notice: PickNotice };

/** Where a document's changes stand: the document, and how many batches of them came. */
export type ChangeState = { document: DocumentToken; seq: number };

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

/** What a host asks of the module for the Locator Recommendation of elements. */
export type RecommendRequest = {
  /** The element the locators are relative to, when given. */
  within?: Element;
  testIdAttribute?: string;
};

/** One element's Locator Recommendation, or why it has none. */
export type RecommendationAnswer = { locator: string } | { error: string };

/** What a host asks of the module about reach, for many elements in one batch. */
export type ReachableRequest = {
  refs: readonly string[];
  /** `click`: a click would reach it. `focus`: nothing blocks its focus. */
  input: "click" | "focus";
};

/** The reach of this document's elements, for a host in the document's own realm. */
export type Reach = ReturnType<typeof createReach>;

/** The one module of a document, under a well-known symbol on its global. */
export type Slot = {
  readonly version: string;
  readonly token: DocumentToken;
  readonly installedBy: HostKey;
  bind(host: HostKey, binding: string): Bound;
  /**
   * A capture of the document for `host`: its roots are the ones its latest
   * completed probe run found, and `inputs` say what it leaves out. `ask`
   * says what else it carries.
   */
  capture(host: HostKey, inputs?: ElementInputs, ask?: CaptureAsk): Capture;
  /** Checks a filter as a registration does, before the page runs it. */
  check(host: HostKey, filter: FilterData): FilterCheck;
  /**
   * Probes the Page Object Root the elements a Locator matched are, for
   * `host`, never scrolling or sending input. With a `round`, the probe
   * labels the root in `host`'s captures once the round ends.
   */
  probe(
    host: HostKey,
    elements: readonly Element[],
    request: ProbeRequest
  ): RootState;
  /** The Structural Ref of each of the elements, named where it has none. */
  mint(host: HostKey, elements: readonly Element[]): string[];
  /** Whether `ref`, now or before, names the one element given. */
  names(host: HostKey, elements: readonly Element[], ref: string): boolean;
  /** `host`'s probe run `round` completed: its roots are the ones captures place now. */
  endRound(host: HostKey, round: number): void;
  /**
   * Whether `host` hears of changes through its binding, from now on, and
   * where the document's changes stand.
   */
  watch(host: HostKey, request: { binding: string; on: boolean }): ChangeState;
  /** Where the document's changes stand. */
  changes(host: HostKey): ChangeState;
  /** Reach (ADR-0041) of the element a ref names, for a host that sends refs. */
  measure(host: HostKey, request: ReachRequest): ReachAnswer;
  /**
   * The refs of `request.refs` whose element would be reached by the input,
   * measured in one batch, in the order given; a ref that names no connected
   * element is not.
   */
  reachable(host: HostKey, request: ReachableRequest): string[];
  /** Whether the predicate keeps each of the elements a host's Locator matched. */
  is(host: HostKey, elements: Element[], predicate: Predicate): boolean[];
  /** The Locator Recommendation of each of the elements, or why it has none. */
  recommend(
    host: HostKey,
    elements: Element[],
    request?: RecommendRequest
  ): RecommendationAnswer[];
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
   * Transitional (#1182): the element `ref`, now or before, named, connected
   * or not.
   */
  elementEverNamed(ref: string): Element | undefined;
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
  const roots = createRoots({ measure: reach.measure, nameOf: refs.nameOf });
  const capture = (
    host: HostKey,
    inputs?: ElementInputs,
    ask?: CaptureAsk
  ): Capture => ({
    document: token,
    url: location.href,
    ...refs.capture(document.body, { ...inputs, ...roots.labelled(host) }, ask),
  });

  /** Tells `host` of `message`, if it is still bound and listening; answers when it has heard. */
  async function tell(host: HostKey, message: HostMessage): Promise<void> {
    const binding = bindings.get(host);
    const listener =
      binding && (globalThis as Record<string, unknown>)[binding];
    if (typeof listener !== "function") return;
    try {
      await listener(token, message);
    } catch {
      // A host that is gone hears nothing.
    }
  }

  // The hosts that hear of changes, and what each was last told.
  const watching = new Set<HostKey>();
  const told = new Map<HostKey, number>();
  const telling = new Set<HostKey>();
  // The batches of change so far: the page's activity, and its navigations.
  let seq = 0;
  let subscribed = false;
  const changed = () => {
    seq += 1;
    for (const host of watching) void tellChange(host);
  };
  /** Tells `host` of the changes so far, one call at a time, and again if more came meanwhile. */
  async function tellChange(host: HostKey): Promise<void> {
    if (telling.has(host) || told.get(host) === seq) return;
    told.set(host, seq);
    telling.add(host);
    await tell(host, { kind: "change", seq });
    telling.delete(host);
    if (watching.has(host)) void tellChange(host);
  }
  const stateOf = (): ChangeState => ({ document: token, seq });

  // The watchers are the document's own: a new document arms new ones.
  const activity = watchActivity(document);
  const actions = createActions({ activity, capture, tell });
  watchSameDocumentNavigations(window, () => {
    for (const host of bindings.keys())
      void tell(host, { kind: "visit", url: location.href });
    changed();
  });
  watchFullLoads(window, actions.loadStarted);

  const recommendLocator = createRecommender({
    InjectedScript,
    generateSelector,
    asLocator,
  });
  return Object.freeze({
    version,
    token,
    installedBy,
    bind(host: HostKey, binding: string): Bound {
      bindings.set(host, binding);
      return { document: token, version, installedBy, host };
    },
    capture,
    check: (_host: HostKey, filter: FilterData) => checkFilter(filter),
    probe: (
      host: HostKey,
      elements: readonly Element[],
      request: ProbeRequest
    ) => roots.probe(host, elements, request),
    mint: (_host: HostKey, elements: readonly Element[]) =>
      elements.map(refs.nameOf),
    names: (
      _host: HostKey,
      [element, ...others]: readonly Element[],
      ref: string
    ) =>
      element !== undefined && !others.length && refs.everNamed(element, ref),
    endRound: (host: HostKey, round: number) => roots.endRound(host, round),
    watch(host: HostKey, { binding, on }: { binding: string; on: boolean }) {
      if (on) {
        bindings.set(host, binding);
        watching.add(host);
        if (!subscribed) {
          subscribed = true;
          // A same-document navigation changes no DOM by itself, but a
          // presence predicate may read the URL: it counts above.
          activity.subscribe(changed);
        }
      } else {
        watching.delete(host);
        told.delete(host);
      }
      return stateOf();
    },
    changes: stateOf,
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
    reachable: (_host: HostKey, { refs: asked, input }: ReachableRequest) =>
      reach.inBatch(() =>
        asked.filter((ref) => {
          const element = refs.elementOf(ref);
          if (!element?.isConnected) return false;
          return input === "focus"
            ? reach.blockingAncestor(element) === undefined
            : reach.measure(element).available;
        })
      ),
    is: (_host: HostKey, elements: Element[], predicate: Predicate) =>
      elements.map(predicates[predicate]),
    recommend: (
      _host: HostKey,
      elements: Element[],
      request: RecommendRequest = {}
    ) =>
      elements.map((element): RecommendationAnswer => {
        try {
          return {
            locator: recommendLocator(
              element,
              request.within,
              request.testIdAttribute
            ),
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    reach,
    begin: actions.begin,
    settle: actions.settle,
    refs: (_host: HostKey, elements: readonly Element[]) =>
      elements.map(refs.lastRefOf),
    queryRef: refs.queryRef,
    elementOf: refs.elementOf,
    elementEverNamed: refs.elementEverNamed,
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
