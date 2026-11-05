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
import { AymeError, RuntimeStateError, type Capture } from "../../shared";
import type {
  Bound,
  ElementInputs,
  HostKey,
  PickNotice,
  ReachAnswer,
  ReachMeasurement,
  ReachRequest,
} from "../page/install";
import { highlightStyles, type HighlightStyle } from "./highlightStyles";

export type {
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

/** A host: one side that drives pages through Playwright's Page. */
export type InPageHost = {
  /** The in-page module as this host sees it on `page`: one per Page. */
  inPage(page: Page): InPage;
};

/**
 * A host of `version`, this package's unless given. A host has one binding
 * in each Page, through which the module will call it.
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
    const inPage: InPage = {
      async bound() {
        exposed ??= page.exposeFunction(
          binding,
          (notice?: PickNotice & { id?: string }) => {
            if (notice?.id !== undefined) listeners.get(notice.id)?.(notice);
          }
        );
        await exposed;
        const result = await page.evaluate(installInPage, {
          version,
          host,
          binding,
        });
        if (result.kind === "version") throw versionError(result.found);
        return result.bound;
      },
      async capture({ elements } = {}) {
        return (await callModule("capture", elements)) as Capture;
      },
      async measureReach(ref, { atCall = false } = {}) {
        const measure = async (stage: ReachRequest["stage"]) =>
          (await callModule("measure", { ref, stage })) as ReachAnswer;
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
        const answer = (await callModule("measure", {
          ref,
          stage: "blocking",
        })) as ReachAnswer;
        return answer.kind === "blocking" ? answer.blocker : undefined;
      },
      async pick(accept, { ignore, signal, styles } = {}) {
        const id = hostKey();
        const paint = highlighting(page, {
          usable: styles?.usable ?? highlightStyles.hover,
          unusable: styles?.unusable ?? highlightStyles.unusable,
        });
        listeners.set(id, paint.show);
        const cancel = () => void callModule("cancelPick", id).catch(() => {});
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          if (signal?.aborted) return undefined;
          return (await callModule("pick", { id, accept, ignore })) as
            string | undefined;
        } finally {
          signal?.removeEventListener("abort", cancel);
          listeners.delete(id);
          await paint.clear();
        }
      },
      async cue(target) {
        await throughModule(() =>
          target.evaluateAll(callOnInPage, {
            version,
            host,
            name: "cue" as const,
          })
        );
      },
    };
    /** A call of the document's module. */
    const callModule = (
      name: "capture" | "measure" | "pick" | "cancelPick",
      inputs: unknown
    ) =>
      throughModule(() =>
        page.evaluate(callInPage, { version, host, name, inputs })
      );

    /** Runs a call of the module, binding to the document's first when it has none. */
    async function throughModule<T>(
      send: () => Promise<
        | { kind: "ok"; value?: T }
        | { kind: "missing" }
        | { kind: "version"; found: string }
      >
    ): Promise<T | undefined> {
      // A document without the module gets it installed, once.
      for (let installed = false; ; installed = true) {
        const result = await send();
        if (result.kind === "ok") return result.value;
        if (result.kind === "version") throw versionError(result.found);
        if (installed)
          throw new RuntimeStateError(
            "The document lost Ayme's in-page module right after it was installed."
          );
        await inPage.bound();
      }
    }
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
