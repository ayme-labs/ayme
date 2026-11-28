/// <reference lib="dom" />

import type {
  actedOnIndex,
  ancestorChain,
  controlsSelector,
} from "../pageRules";
import type { InputNote } from "../pageValues";

// The watches the adapter installs in a recorded page. Each function is sent
// to the page as its own text, so it uses nothing from outside itself but
// what it is given (docs/testing.md#code-a-real-browser-runs).

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

/** The target watch of one document, as the adapter reaches it. */
export type TargetWatch = {
  /** Notes no input any more, for a browser the adapter lets go of. */
  stop(): void;
};

declare global {
  interface Window {
    __aymeRecorderTargetWatch?: TargetWatch;
  }
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
 * along only to say which report the note is of, and so does the held click
 * the event is, as the gate tells it (`heldClickOf`): it runs before this,
 * on `window`.
 */
export function targetWatchIn(tell: string, rules: TargetRules): void {
  if (window.__aymeRecorderTargetWatch) return;
  const told = (seen: InputNote) =>
    void (
      window as unknown as Record<string, (seen: InputNote) => Promise<void>>
    )[tell]!(seen);
  const heldClickOf = (event: Event) =>
    window.__aymeRecorderGate?.heldClickOf(event) ?? null;
  const read = (event: Event) => {
    if (!event.isTrusted) return;
    const target = event.composedPath()[0];
    const held = heldClickOf(event);
    if (!(target instanceof Element))
      return told({ type: event.type, chain: [], under: null, held });
    told({
      type: event.type,
      chain: rules.ancestorChain(
        rules.actedOn(target, rules),
        rules.elementAbove,
        rules.ariaRefOf
      ),
      under: rules.ariaRefOf(target),
      held,
    });
  };
  // Playwright's recorder listens on the document as the event goes down;
  // a listener on the root element runs right after it.
  const types = ["click", "contextmenu", "auxclick", "keydown", "input"];
  const install = () => {
    for (const type of types)
      document.documentElement.addEventListener(type, read, true);
  };
  const waiting = new MutationObserver(() => {
    if (!document.documentElement) return;
    waiting.disconnect();
    install();
  });
  if (document.documentElement) install();
  else waiting.observe(document, { childList: true });
  window.__aymeRecorderTargetWatch = {
    stop: () => {
      waiting.disconnect();
      for (const type of types)
        document.documentElement?.removeEventListener(type, read, true);
    },
  };
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
 * open shadow roots included, and whenever a field's value does, as with
 * each key typed. It only says that something happened: what a
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
      // Typing changes a field's value and none of the page's elements:
      // each key is activity all the same, so that the quiet a Settled Page
      // needs starts again after it.
      window.removeEventListener("input", tell, true);
      if (!on) return;
      window.addEventListener("input", tell, true);
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
