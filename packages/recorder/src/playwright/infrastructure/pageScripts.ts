/// <reference lib="dom" />

// What the adapter runs inside a recorded page. Each function is sent to
// the page as its own text, so it uses nothing from outside itself: no
// import, and no value of this module.

/** What a page tells of an input it held back. */
export type HeldClick = {
  /** Where it was, in the frame's viewport. */
  readonly x: number;
  readonly y: number;
  /** The click's count: 2 for the second click of a double click. */
  readonly detail: number;
  readonly modifiers: readonly ("Alt" | "Control" | "Meta" | "Shift")[];
};

/** The gate of one document, as the adapter reaches it. */
export type Gate = {
  /** Holds inputs back from now on, or no longer. Returns what it was set to. */
  set(on: boolean): boolean;
  /** A held click is on its way to this point of the viewport: let it
   * through. The gate closes again by itself when the click has arrived. */
  open(at: { x: number; y: number }): void;
  /** Closes the gate after a click that never arrived. */
  close(): void;
};

declare global {
  interface Window {
    __aymeRecorderGate?: Gate;
    __aymeRecorderActivity?: ActivityWatch;
  }
}

/**
 * Installs the gate in a document, switched off. Switched on, it holds back
 * the click that ends a press of the left mouse button, and tells the
 * adapter through the binding called `held`. Only that final click is held:
 * the press and the release reach the page as they come, so pressing,
 * dragging and selecting text behave as they do without it.
 *
 * It listens on `window`, before anything of the page and before
 * Playwright's recorder, which listens on `document`: neither sees a held
 * click until the adapter sends it on.
 */
export function installGate(held: string): void {
  // Only the top document for now: a click in a frame would need its place
  // in the page.
  if (window.__aymeRecorderGate || window.top !== window) return;
  let on = false;
  let passingOn: { x: number; y: number } | undefined;
  let swallowDoubleClick = false;
  window.__aymeRecorderGate = {
    set: (next) => (on = next),
    open: (at) => {
      passingOn = at;
    },
    close: () => {
      passingOn = undefined;
    },
  };

  // Native pickers, which Playwright's recorder leaves alone as well.
  const pickers = new Set([
    "color",
    "date",
    "datetime-local",
    "file",
    "month",
    "range",
    "time",
    "week",
  ]);
  const leftAlone = (target: EventTarget | undefined) =>
    !(target instanceof Element) ||
    target.nodeName === "SELECT" ||
    target.nodeName === "OPTION" ||
    (target instanceof HTMLInputElement && pickers.has(target.type));
  const swallow = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  const onMouse = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    // The click sent on is known by its place: whatever the person does
    // elsewhere meanwhile is theirs.
    if (
      passingOn &&
      Math.abs(event.clientX - passingOn.x) < 1 &&
      Math.abs(event.clientY - passingOn.y) < 1
    ) {
      // Its press and its release already reached the page once, from the
      // person: only its click is let through.
      if (event.type === "mousedown") swallow(event);
      else if (event.type === "click") passingOn = undefined;
      else event.stopImmediatePropagation();
      return;
    }
    if (!on) return;
    if (event.type === "dblclick") {
      // It comes back with the second click, when that is sent on.
      if (swallowDoubleClick) swallow(event);
      swallowDoubleClick = false;
      return;
    }
    if (event.type !== "click") return;
    // A click with no count is a key's or a label's, not the mouse's.
    if (
      event.button !== 0 ||
      event.detail === 0 ||
      leftAlone(event.composedPath()[0])
    )
      return;
    swallow(event);
    swallowDoubleClick = event.detail >= 2;
    const modifiers: HeldClick["modifiers"] = [
      ...(event.altKey ? (["Alt"] as const) : []),
      ...(event.ctrlKey ? (["Control"] as const) : []),
      ...(event.metaKey ? (["Meta"] as const) : []),
      ...(event.shiftKey ? (["Shift"] as const) : []),
    ];
    const click: HeldClick = {
      x: event.clientX,
      y: event.clientY,
      detail: event.detail,
      modifiers,
    };
    void (
      window as unknown as Record<string, (click: HeldClick) => Promise<void>>
    )[held]!(click);
  };
  for (const type of [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "dblclick",
  ] as const)
    window.addEventListener(type, onMouse as EventListener, true);
}

/** Hides what Playwright's recorder draws over the page. */
export function hidePlaywrightOverlay(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync("x-pw-glass { display: none !important; }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

/** The activity watch of one document, as the adapter reaches it. */
export type ActivityWatch = {
  /** Tells of every change from now on, or no longer. */
  watch(on: boolean): void;
};

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
