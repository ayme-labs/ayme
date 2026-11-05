import type {
  Disposable,
  JSHandle,
  Locator,
  Page,
  Selectors,
} from "@playwright/test";
import {
  aymeRefEngine,
  callInPage,
  callOnInPage,
  installInPage,
} from "virtual:ayme-in-page";

import { version as packageVersion } from "../../../package.json";
import {
  AymeError,
  RuntimeStateError,
  type ActionOutcome,
  type Capture,
  type DocumentToken,
} from "../../shared";
import type { CallName, CallResult } from "../page/call";
import type { CallOnResult } from "../page/callOn";
import type {
  ActionInputs,
  Begun,
  Bound,
  ElementInputs,
  HostKey,
  HostMessage,
  PickNotice,
  ReachAnswer,
  ReachMeasurement,
  ReachRequest,
  Settled,
} from "../page/install";
import { highlightStyles, type HighlightStyle } from "./highlightStyles";

export type {
  ActionInputs,
  Bound,
  Capture,
  DocumentToken,
  ElementInputs,
  HostKey,
  ReachMeasurement,
} from "../page/install";

const gone: ReachMeasurement = { present: false, available: false };
const reached: ReachMeasurement = { present: true, available: true };

/** The document runs another version's in-page module, so this host cannot use it. */
export class InPageVersionError extends AymeError {
  override readonly name = "InPageVersionError";
  readonly kind = "runtime";
}

/** The in-page module of the document a Page shows, as one host sees it. */
export type InPage = {
  /** Installs the module, or binds to the one there, and says what is there. */
  bound(): Promise<Bound>;
  /**
   * A capture of the document the Page shows now, binding to its module
   * first when needed. Records nothing.
   */
  capture(options?: CaptureOptions): Promise<Capture>;
  /**
   * Reach (ADR-0041) of the element `ref` names, measured in the page: what
   * a click would reach, and what blocks or takes it, named by Structural
   * Ref. An element that is gone is absent. With `atCall`, the element is
   * scrolled into view first, as the call that clicks it scrolls, and the
   * hit test is where the click lands.
   */
  measureReach(
    ref: string,
    options?: { atCall?: boolean }
  ): Promise<ReachMeasurement>;
  /**
   * The ref of what blocks every click on the element `ref` names and its
   * focus: the last opened native modal it is not in, else its inert ancestor.
   */
  blockingAncestor(ref: string): Promise<string | undefined>;
  /**
   * Picks a Structural Ref by pointing at the document. The element under
   * the pointer that has a ref is boxed with the hover highlight, or the
   * unusable one when its ref is not in `accept`; a click picks an accepted
   * one, Esc cancels, and the page itself handles none of these presses.
   * Answers the ref picked, or nothing when Esc or `options.signal` ends it.
   */
  pick(
    accept: readonly string[],
    options?: PickOptions
  ): Promise<string | undefined>;
  /**
   * Shows Demo Mode's click cue where `target` is, if it matches one element
   * now, and answers when the cue has gone. Reads the element's geometry in
   * the page and waits for nothing.
   */
  cue(target: Locator): Promise<void>;
  /**
   * An action's before capture, which also arms the watch for a full load
   * the action starts: one call into the page.
   */
  begin(options?: ActionOptions): Promise<InPageAction>;
  /**
   * Calls `listener` when this host binds a document new to it, and after
   * each same-document navigation in the document it is bound to, until the
   * returned function is called. A host that outlives a full load binds the
   * next document as soon as it has loaded while anyone listens.
   */
  onVisit(listener: (visit: VisitSignal) => void): () => void;
  /** Reads of the elements a Locator matches, in the page. */
  readonly elements: ElementReads;
};

/** An action begun on a document: the page before it, and the action itself. */
export type InPageAction = {
  readonly before: Capture;
  /**
   * Calls `perform` once, then waits in the page for a Settled Page and
   * captures it: one call into the page, held while the page goes quiet.
   * Answers at once when a full load starts. Never throws what `perform`
   * throws: that comes back as `threw`, once the page settled.
   */
  perform<T>(perform: () => T | Promise<T>): Promise<ActionOutcome<T>>;
};

export type ElementReads = {
  /**
   * The Structural Ref each element `target` matches has in its document,
   * undefined for one never captured. Never installs the module: a document
   * without one has no refs.
   */
  refs(target: Locator): Promise<(string | undefined)[]>;
};

/** A document this host bound, or a same-document navigation in it: for Visits. */
export type VisitSignal = {
  document: DocumentToken;
  url: string;
  cause: "initial" | "navigate";
};

export type PickOptions = {
  /** A CSS selector for the subtrees picking leaves alone, such as the Inspector's host. */
  ignore?: string;
  /** Ends picking, as Esc does, when it aborts. */
  signal?: AbortSignal;
  /** The highlight styles of an element that can be picked and of one that cannot. */
  styles?: { usable?: HighlightStyle; unusable?: HighlightStyle };
};

export type CaptureOptions = {
  /**
   * Transitional: the host's Page Object Roots and ignore predicate as a
   * handle to live values in the page (`ElementInputs`), until the registry
   * probes in the page (#1175) and `ignore` takes a selector (#1177).
   */
  elements?: JSHandle<ElementInputs>;
};

export type ActionOptions = {
  /**
   * Transitional, as `CaptureOptions.elements`: given as a function, the
   * module reads it again before each of the action's captures.
   */
  elements?: JSHandle<ActionInputs>;
};

/** A host: one side that drives pages through Playwright's Page. */
export type InPageHost = {
  /** The in-page module as this host sees it on `page`: one per Page. */
  inPage(page: Page): InPage;
};

/** A full load an action started: where to, and the old document's last capture. */
type LoadStarted = { url: string; after?: Capture };

/**
 * A host of `version`, this package's unless given. A host has one binding
 * in each Page, through which the module calls it.
 */
export function createInPageHost(version = packageVersion): InPageHost {
  const host = hostKey();
  const binding = `__ayme_${host}`;
  const pages = new WeakMap<Page, InPage>();
  // The pickings that are on, to hear what the module tells through the binding.
  const listeners = new Map<string, (notice: PickNotice) => void>();

  const versionError = (found: string) =>
    new InPageVersionError(
      `This document runs Ayme's in-page module ${found}; this host is ${version}.`
    );

  function forPage(page: Page): InPage {
    let exposed: Promise<unknown> | undefined;
    // The document this host last bound in the Page.
    let current: DocumentToken | undefined;
    const visitListeners = new Set<(visit: VisitSignal) => void>();
    let followsLoads = false;
    // Loads the module told of, by document and action, until the action's
    // perform takes them, or this host leaves the document.
    const loads = new Map<string, LoadStarted>();
    const loadListeners = new Map<string, (load: LoadStarted) => void>();

    const visit = (signal: VisitSignal) => {
      for (const listener of [...visitListeners]) listener(signal);
    };
    const entered = (document: DocumentToken, url: string) => {
      if (document === current) return;
      current = document;
      for (const key of loads.keys())
        if (!key.startsWith(`${document} `)) loads.delete(key);
      visit({ document, url, cause: "initial" });
    };

    /** What the module tells this host about a document; another document's news is dropped. */
    function hear(document: DocumentToken, message: HostMessage) {
      if (message.kind === "pick") {
        listeners.get(message.id)?.(message.notice);
        return;
      }
      if (message.kind === "visit") {
        if (document === current)
          visit({ document, url: message.url, cause: "navigate" });
        return;
      }
      const key = `${document} ${message.action}`;
      const load = {
        url: message.url,
        ...(message.after && { after: message.after }),
      };
      const listener = loadListeners.get(key);
      if (listener) listener(load);
      else loads.set(key, load);
    }

    // Once per Page. A Playwright Lite window has one binding per name, so a
    // second Page of this host in it shares the first one's: the one failure
    // to expose it that the host passes over.
    const expose = () =>
      (exposed ??= page
        .exposeFunction(binding, hear)
        .catch((error: unknown) => {
          if (!alreadyRegistered(error, binding)) throw error;
        }));

    async function bound(): Promise<Bound> {
      await expose();
      const result = await page.evaluate(installInPage, {
        version,
        host,
        binding,
      });
      if (result.kind === "version") throw versionError(result.found);
      entered(result.bound.document, result.url);
      return result.bound;
    }

    /** The module's `name` in the document the Page shows, installed there first when it is missing. */
    const call = <T>(name: CallName, args: unknown[]) =>
      throughModule<T>(() =>
        page.evaluate(callInPage, {
          version,
          host,
          binding,
          token: current,
          name,
          args,
        })
      );

    /** Sends a call of the module, binding to the document's first when it has none. */
    async function throughModule<T>(
      send: () => Promise<CallResult<unknown> | CallOnResult<unknown>>
    ): Promise<T> {
      await expose();
      for (let installed = false; ; installed = true) {
        const result = await send();
        if (result.kind === "ok") {
          if ("entered" in result && result.entered)
            entered(result.entered.document, result.entered.url);
          return result.value as T;
        }
        if (result.kind === "version") throw versionError(result.found);
        if (installed)
          throw new RuntimeStateError(
            "The document lost Ayme's in-page module right after it was installed."
          );
        await bound();
      }
    }

    /**
     * The Settled Page after `action` in `document`, or the load that ended
     * it. Only a document that went away is a load: the context the call ran
     * in was destroyed, or the Page shows a document other than the action's,
     * one the old document never saw start, such as one the host started
     * itself. Anything else rejects.
     */
    async function settle(
      document: DocumentToken,
      action: number,
      elements: ActionOptions["elements"]
    ): Promise<Settled> {
      let result;
      try {
        result = await page.evaluate(callInPage, {
          version,
          host,
          binding,
          token: document,
          strict: true,
          name: "settle" as const,
          args: [action, elements],
        });
      } catch (error) {
        // Real Playwright reports a load as the context it destroyed.
        if (page.isClosed() || !contextDestroyed(error)) throw error;
        return { loading: page.url() };
      }
      // Any answer but the module's is another document's: its token, no
      // module yet, or another version's.
      return result.kind === "ok"
        ? (result.value as Settled)
        : { loading: page.url() };
    }

    function action(
      { action, before }: Begun,
      elements: ActionOptions["elements"]
    ): InPageAction {
      let performed = false;
      const document = before.document;
      const key = `${document} ${action}`;
      const loading = ({ url, after }: LoadStarted) =>
        ({ kind: "loading", url, ...(after && { after }) }) as const;
      return {
        before,
        async perform<T>(perform: () => T | Promise<T>) {
          if (performed)
            throw new RuntimeStateError("An action performs only once.");
          performed = true;
          const loadStarted = new Promise<LoadStarted>((resolve) => {
            const told = loads.get(key);
            if (told) resolve(told);
            else loadListeners.set(key, resolve);
          });
          const settling = (async (): Promise<ActionOutcome<T>> => {
            let done:
              | { kind: "settled"; result: T }
              | { kind: "threw"; error: unknown };
            try {
              done = { kind: "settled", result: await perform() };
            } catch (error) {
              done = { kind: "threw", error };
            }
            const settled = await settle(document, action, elements);
            if ("loading" in settled)
              return loading({ url: settled.loading, after: settled.after });
            if ("failed" in settled)
              return {
                kind: "threw",
                error:
                  done.kind === "threw"
                    ? done.error
                    : new RuntimeStateError(settled.failed),
                stable: settled.stable,
              };
            return { ...done, stable: settled.stable, after: settled.after };
          })();
          try {
            return await Promise.race([settling, loadStarted.then(loading)]);
          } finally {
            loadListeners.delete(key);
            loads.delete(key);
            // A load answered first: the rest finishes on its own.
            settling.catch(() => {});
          }
        },
      };
    }

    const inPage: InPage = {
      bound,
      capture: ({ elements } = {}) => call<Capture>("capture", [elements]),
      async begin({ elements } = {}) {
        return action(await call<Begun>("begin", [elements]), elements);
      },
      async measureReach(ref, { atCall = false } = {}) {
        const measure = (stage: ReachRequest["stage"]) =>
          call<ReachAnswer>("measure", [{ ref, stage }]);
        const answered = (answer: ReachAnswer): ReachMeasurement =>
          answer.kind === "measured" && answer.measurement !== "scroll"
            ? answer.measurement
            : gone;
        if (!atCall) return answered(await measure("current"));
        const before = await measure("before-scroll");
        if (before.kind !== "measured" || before.measurement !== "scroll")
          return answered(before);
        // A scroll that fails leaves the measurement to the action, whose
        // own error says why.
        try {
          await page.locator(`ayme-ref=${ref}`).scrollIntoViewIfNeeded();
        } catch {
          return reached;
        }
        return answered(await measure("after-scroll"));
      },
      async blockingAncestor(ref) {
        const answer = await call<ReachAnswer>("measure", [
          { ref, stage: "blocking" },
        ]);
        return answer.kind === "blocking" ? answer.blocker : undefined;
      },
      async pick(accept, { ignore, signal, styles } = {}) {
        const id = hostKey();
        const paint = highlighting(page, {
          usable: styles?.usable ?? highlightStyles.hover,
          unusable: styles?.unusable ?? highlightStyles.unusable,
        });
        listeners.set(id, paint.show);
        const cancel = () => void call("cancelPick", [id]).catch(() => {});
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          if (signal?.aborted) return undefined;
          return await call<string | undefined>("pick", [
            { id, accept, ignore },
          ]);
        } finally {
          signal?.removeEventListener("abort", cancel);
          listeners.delete(id);
          await paint.clear();
        }
      },
      async cue(target) {
        await throughModule<void>(() =>
          target.evaluateAll(callOnInPage, {
            version,
            host,
            name: "cue" as const,
          })
        );
      },
      onVisit(listener) {
        const subscribed = (signal: VisitSignal) => listener(signal);
        visitListeners.add(subscribed);
        if (!followsLoads) {
          followsLoads = true;
          // Playwright Lite never fires it for a new document: its host
          // goes with the old one.
          page.on("domcontentloaded", () => {
            if (visitListeners.size) bound().catch(() => {});
          });
        }
        return () => {
          visitListeners.delete(subscribed);
        };
      },
      elements: {
        async refs(target) {
          const result = await target.evaluateAll(callOnInPage, {
            version,
            host,
            name: "refs" as const,
          });
          if (result.kind === "version") throw versionError(result.found);
          return result.kind === "ok"
            ? (result.value as (string | undefined)[])
            : Array.from({ length: result.matched }, () => undefined);
        },
      },
    };
    return inPage;
  }

  return {
    inPage(page) {
      let found = pages.get(page);
      if (!found) pages.set(page, (found = forPage(page)));
      return found;
    },
  };
}

/**
 * Boxes the element a picking points at through Playwright's highlight, one
 * at a time, in order: `show` for each notice, `clear` when picking ends.
 */
function highlighting(
  page: Page,
  styles: { usable: HighlightStyle; unusable: HighlightStyle }
) {
  let current: Disposable | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const then = (step: () => Promise<void>) =>
    (queue = queue.then(step, step).catch(() => {}));
  const dispose = async () => {
    await current?.dispose();
    current = undefined;
  };
  return {
    show: (notice: PickNotice) =>
      void then(async () => {
        await dispose();
        if (notice.ref === undefined) return;
        current = await page.locator(`ayme-ref=${notice.ref}`).highlight({
          style: notice.usable ? styles.usable : styles.unusable,
        });
      }),
    clear: () => then(dispose),
  };
}

/** Whether `error` is Playwright's for a binding named `binding` that the Page already has. */
function alreadyRegistered(error: unknown, binding: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes(`Function "${binding}" has been already registered`)
  );
}

/** Whether `error` is Playwright's for a call whose context a navigation destroyed. */
function contextDestroyed(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Execution context was destroyed")
  );
}

function hostKey(): HostKey {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

const thisHost = createInPageHost();

/** The in-page module of the document `page` shows, as this host sees it. */
export function inPage(page: Page): InPage {
  return thisHost.inPage(page);
}

// Each runtime's selectors registry the engine is registered on.
const registered = new WeakSet<Selectors>();

/**
 * Registers the `ayme-ref` selector engine (ADR-0038) on a runtime's
 * `selectors`, Playwright Lite's or Playwright's, in the page's main world:
 * `ayme-ref=e5` then resolves through the document's in-page module, whichever
 * host captured it. Once per registry, before the pages that use it.
 */
export async function registerAymeRef(selectors: Selectors): Promise<void> {
  if (registered.has(selectors)) return;
  registered.add(selectors);
  await selectors.register("ayme-ref", aymeRefEngine);
}
