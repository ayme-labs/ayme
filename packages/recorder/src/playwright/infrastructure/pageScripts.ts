/// <reference lib="dom" />

// What the adapter runs inside a recorded page. Each function is sent to
// the page as its own text, so it uses nothing from outside itself: no
// import, and no value of this module.

/** The modifier keys held with an input. */
export type Modifier = "Alt" | "Control" | "Meta" | "Shift";

/** What a page tells of an input it held back. `seq` numbers the inputs a
 * document held, from 1. */
export type HeldByPage =
  | {
      readonly kind: "click";
      readonly seq: number;
      /** Where it was, in the frame's viewport. */
      readonly x: number;
      readonly y: number;
      /** The click's count: 2 for the second click of a double click. */
      readonly detail: number;
      readonly modifiers: readonly Modifier[];
    }
  | {
      readonly kind: "key";
      readonly seq: number;
      /** Typing, as opposed to a key press Playwright records as a press. */
      readonly typing: boolean;
      readonly key: string;
      readonly code: string;
      readonly modifiers: readonly Modifier[];
    };

/** The gate of one document, as the adapter reaches it. */
export type Gate = {
  /** Holds inputs back from now on, or no longer. Switched on, it also holds
   * everything that follows, typing included, until it is let through.
   * Switched off, it lets what follows through once nothing it held waits
   * to be passed on. Returns what it was set to. */
  set(on: boolean): boolean;
  /** A held input is on its way: the click to this point of the viewport,
   * or the key with this code. Lets it through; the gate closes again by
   * itself when it has arrived. */
  open(input: { x: number; y: number } | { code: string }): void;
  /** Closes the gate after an input that never arrived. */
  close(): void;
  /** Lets what follows through, unless the document held an input after
   * the `upTo`th. */
  letThrough(upTo: number): void;
};

declare global {
  interface Window {
    __aymeRecorderGate?: Gate;
    __aymeRecorderActivity?: ActivityWatch;
  }
}

/**
 * Installs the gate in a document, switched off. Switched on, it holds back
 * the click that ends a press of the left mouse button and a key press that
 * Playwright records as a press, and tells the adapter through the binding
 * called `held`. Only the final click is held: the press and the release
 * reach the page as they come, so pressing, dragging and selecting text
 * behave as they do without it. Once it has held an input, it holds every
 * key after it, typing included, until it is let through: input reaches
 * the page in the order it was given.
 *
 * It listens on `window`, before anything of the page and before
 * Playwright's recorder, which listens on `document`: neither sees a held
 * input until the adapter sends it on.
 */
export function installGate(held: string): void {
  // Only the top document for now: a click in a frame would need its place
  // in the page.
  if (window.__aymeRecorderGate || window.top !== window) return;
  let on = false;
  let holding = false;
  /** How many inputs it held, and how many of those still wait. */
  let seq = 0;
  let waiting = 0;
  let passingOn: { x: number; y: number } | undefined;
  let passingKey: string | undefined;
  let swallowDoubleClick = false;
  /** The codes of held keys whose release is the gate's too. */
  const swallowKeyUp = new Set<string>();
  const arrived = () => {
    waiting = Math.max(0, waiting - 1);
    if (!on && waiting === 0) holding = false;
  };
  window.__aymeRecorderGate = {
    set: (next) => {
      on = next;
      if (on) holding = true;
      else if (waiting === 0) holding = false;
      return on;
    },
    open: (input) => {
      if ("code" in input) passingKey = input.code;
      else passingOn = input;
    },
    close: () => {
      if (passingOn || passingKey) arrived();
      passingOn = undefined;
      passingKey = undefined;
    },
    letThrough: (upTo) => {
      if (seq <= upTo) holding = false;
    },
  };
  const tell = (input: HeldByPage) =>
    void (
      window as unknown as Record<string, (input: HeldByPage) => Promise<void>>
    )[held]!(input);
  const modifiersOf = (event: MouseEvent | KeyboardEvent): Modifier[] => [
    ...(event.altKey ? (["Alt"] as const) : []),
    ...(event.ctrlKey ? (["Control"] as const) : []),
    ...(event.metaKey ? (["Meta"] as const) : []),
    ...(event.shiftKey ? (["Shift"] as const) : []),
  ];

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
      else if (event.type === "click") {
        passingOn = undefined;
        arrived();
      } else event.stopImmediatePropagation();
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
    holding = true;
    waiting += 1;
    tell({
      kind: "click",
      seq: ++seq,
      x: event.clientX,
      y: event.clientY,
      detail: event.detail,
      modifiers: modifiersOf(event),
    });
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

  const editable = (target: EventTarget | undefined) =>
    target instanceof Element &&
    (target.nodeName === "INPUT" ||
      target.nodeName === "TEXTAREA" ||
      (target instanceof HTMLElement && target.isContentEditable));
  /** Whether Playwright's recorder records the key as a press, as its
   * `JsonRecordActionTool` decides; otherwise it is typing. */
  const recordedAsPress = (event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    if (
      event.key === "Enter" &&
      target instanceof Element &&
      (target.nodeName === "TEXTAREA" ||
        (target instanceof HTMLElement && target.isContentEditable))
    )
      return false;
    if (["Backspace", "Delete", "AltGraph"].includes(event.key)) return false;
    if (event.key === "@" && event.code === "KeyL") return false;
    if (navigator.platform.includes("Mac")) {
      if (event.key === "v" && event.metaKey) return false;
    } else {
      if (event.key === "v" && event.ctrlKey) return false;
      if (event.key === "Insert" && event.shiftKey) return false;
    }
    const withModifier = event.ctrlKey || event.altKey || event.metaKey;
    if (event.key.length === 1 && !withModifier) return !editable(target);
    return true;
  };
  // A modifier on its own changes nothing on the page.
  const bare = new Set(["Shift", "Control", "Meta", "Alt", "Process"]);

  const onKey = (event: KeyboardEvent) => {
    if (!event.isTrusted) return;
    if (event.type === "keyup") {
      if (swallowKeyUp.delete(event.code)) swallow(event);
      return;
    }
    if (passingKey !== undefined && event.code === passingKey) {
      passingKey = undefined;
      arrived();
      return;
    }
    if (bare.has(event.key) || event.isComposing) return;
    const press = on && recordedAsPress(event);
    if (!press && !holding) return;
    swallow(event);
    swallowKeyUp.add(event.code);
    holding = true;
    waiting += 1;
    tell({
      kind: "key",
      seq: ++seq,
      typing: !press,
      key: event.key,
      code: event.code,
      modifiers: modifiersOf(event),
    });
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
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
