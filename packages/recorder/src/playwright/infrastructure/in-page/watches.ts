/// <reference lib="dom" />

import type {
  actedOnIndex,
  ancestorChain,
  controlsSelector,
} from "../pageRules";

// The watches the adapter installs in a recorded page. Each function is sent
// to the page as its own text, so it uses nothing from outside itself but
// what it is given (docs/testing.md#code-a-real-browser-runs).

/** What a document tells of an input's target: the refs Playwright's
 * recorder gave the target and each of its ancestors, nearest first, null
 * where it gave none. */
export type TargetChain = {
  readonly type: string;
  /** From the element the input acted on, as Playwright's selector names
   * it, up. */
  readonly chain: readonly (string | null)[];
  /** The ref of the element under the pointer, which Playwright's report
   * names as its ref: it says which report this is the note of. */
  readonly under: string | null;
};

/** The element above an element, through an open shadow root to its host;
 * null above the top. */
export function elementAbove(element: Element): Element | null {
  return (
    element.parentElement ??
    ((element.getRootNode() as ShadowRoot).host || null)
  );
}

/** The ref Playwright's recorder tagged an element with when it took its
 * picture of the page (`_ariaRef`, a private part of Playwright). */
export function ariaRefOf(element: Element): string | null {
  return (
    (element as Element & { _ariaRef?: { ref?: string } })._ariaRef?.ref ?? null
  );
}

/** What the target watch and the read of a target's ancestors are sent
 * with: the walk, and how to go up and read a ref in the page. */
export type AncestorRules = {
  readonly ancestorChain: typeof ancestorChain;
  readonly elementAbove: typeof elementAbove;
  readonly ariaRefOf: typeof ariaRefOf;
};

/** What the target watch is sent with besides: how to tell the element an
 * input acted on. */
export type TargetRules = AncestorRules & {
  readonly actedOnIndex: typeof actedOnIndex;
  readonly controlsSelector: typeof controlsSelector;
  readonly actedOn: typeof actedOn;
};

/** The element an input given to `element` acted on, as Playwright's
 * selector names it: the nearest visible control around it, or itself. */
export function actedOn(element: Element, rules: TargetRules): Element {
  const path: Element[] = [];
  for (let at: Element | null = element; at; at = rules.elementAbove(at))
    path.push(at);
  const visible = (at: Element) => {
    const style = getComputedStyle(at);
    if (style.display === "contents") return true;
    if (style.visibility !== "visible") return false;
    const box = at.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const index = rules.actedOnIndex(
    path.map((at) => ({
      field:
        at.matches("input, textarea, select") ||
        (at instanceof HTMLElement && at.isContentEditable),
      interactive: at.matches(rules.controlsSelector()),
      visible: visible(at),
    }))
  );
  return path[index]!;
}

/**
 * Installs the target watch in a document. Playwright's recorder takes its
 * picture of the page while it handles an input, and leaves each element it
 * lists tagged with its ref. Right after it, this reads those tags off the
 * element the input acted on, as Playwright's selector names it, and its
 * ancestors, through open shadow roots, and tells them through the binding
 * called `tell`: an element the picture does not list is then known by its
 * nearest ancestor that it does. The element under the pointer can be one
 * inside a link or a button: its ref, which Playwright's report names, goes
 * along only to say which report the note is of.
 */
export function targetWatchIn(tell: string, rules: TargetRules): void {
  const told = (seen: TargetChain) =>
    void (
      window as unknown as Record<string, (seen: TargetChain) => Promise<void>>
    )[tell]!(seen);
  const read = (event: Event) => {
    if (!event.isTrusted) return;
    const target = event.composedPath()[0];
    if (!(target instanceof Element))
      return told({ type: event.type, chain: [], under: null });
    told({
      type: event.type,
      chain: rules.ancestorChain(
        rules.actedOn(target, rules),
        rules.elementAbove,
        rules.ariaRefOf
      ),
      under: rules.ariaRefOf(target),
    });
  };
  // Playwright's recorder listens on the document as the event goes down;
  // a listener on the root element runs right after it.
  const install = () => {
    for (const type of ["click", "contextmenu", "keydown", "input"])
      document.documentElement.addEventListener(type, read, true);
  };
  if (document.documentElement) install();
  else
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      observer.disconnect();
      install();
    }).observe(document, { childList: true });
}

/** The refs of an element and its ancestors, nearest first, as the target
 * watch reads them: for a report whose own note of its target came too
 * late. The element is the one Playwright's selector names. */
export function ancestorRefsIn(
  element: Element,
  rules: AncestorRules
): (string | null)[] {
  return rules.ancestorChain(element, rules.elementAbove, rules.ariaRefOf);
}

/** The activity watch of one document, as the adapter reaches it. */
export type ActivityWatch = {
  /** Tells of every change from now on, or no longer. */
  watch(on: boolean): void;
};

declare global {
  interface Window {
    __aymeRecorderActivity?: ActivityWatch;
  }
}

/**
 * Installs the activity watch in a document, switched off. Switched on, it
 * calls the binding named `changed` whenever the document's elements change,
 * open shadow roots included. It only says that something happened: what a
 * Settled Page is, core decides, in the adapter's process.
 */
export function installActivityWatch(changed: string): void {
  if (window.__aymeRecorderActivity) return;
  const tell = () =>
    void (window as unknown as Record<string, () => Promise<void>>)[changed]!();
  const observer = new MutationObserver(tell);
  window.__aymeRecorderActivity = {
    watch(on) {
      observer.disconnect();
      if (!on) return;
      const observe = (root: Document | ShadowRoot) => {
        observer.observe(root, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        for (const element of root.querySelectorAll("*"))
          if (element.shadowRoot) observe(element.shadowRoot);
      };
      observe(document);
    },
  };
}
