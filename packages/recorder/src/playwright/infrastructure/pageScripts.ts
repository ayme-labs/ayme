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
      /** Where it was, in its own document's viewport. */
      readonly x: number;
      readonly y: number;
      /** The click's count: 2 for the second click of a double click. */
      readonly detail: number;
      readonly modifiers: readonly Modifier[];
      /** The document it was held in. */
      readonly document: string;
    }
  | {
      readonly kind: "key";
      readonly seq: number;
      /** Typing, as opposed to a key press Playwright records as a press. */
      readonly typing: boolean;
      /** It went to the document itself: no element had focus. */
      readonly nothingFocused: boolean;
      readonly key: string;
      readonly code: string;
      readonly modifiers: readonly Modifier[];
      /** The document it was held in. */
      readonly document: string;
    };

/** The gate of one document, as the adapter reaches it. */
export type Gate = {
  /** Holds inputs back from now on, or no longer. Switched on, it also holds
   * everything that follows, typing included, until it is let through.
   * Switched off, it lets what follows through, clicks included, once
   * nothing it held waits to be passed on. Returns what it was set to. */
  set(on: boolean): boolean;
  /** A held input is on its way: the click of this count to this point of
   * the viewport, or the key with this code. Lets it through; the gate
   * closes again by itself when it has arrived. Resolves when the input may
   * be sent, as a click waits while the person holds a mouse button down:
   * to false, letting nothing through, when the input was held in another
   * document: that one is gone. */
  open(
    input: { x: number; y: number; detail: number } | { code: string },
    document: string
  ): Promise<boolean>;
  /** Closes the gate after an input that never arrived. */
  close(): void;
  /** Lets what follows through, unless the document held an input after
   * the `upTo`th. */
  letThrough(upTo: number): void;
  // Assert visibility.
  /** Leaves every input alone while Playwright's recorder picks an element,
   * or no longer: the picking click is Playwright's, and never reaches the
   * page. It stops by itself after the picking click. */
  pick(on: boolean): void;
};

declare global {
  interface Window {
    __aymeRecorderGate?: Gate;
    __aymeRecorderActivity?: ActivityWatch;
    __aymeRecorderGateStart?: GateStart;
  }
}

/** Whether a document's gate starts on, and the change that said so. */
export type GateStart = { readonly on: boolean; readonly change: number };

/**
 * Says whether the gate of a document that starts from now on holds inputs
 * back. The adapter adds it as one more script for every new document each
 * time the gate is switched, since a script cannot be taken back on every
 * Playwright: the latest change wins, in whatever order the scripts run.
 */
export function startGate(start: GateStart): void {
  const now = window.__aymeRecorderGateStart;
  if (now && now.change > start.change) return;
  window.__aymeRecorderGateStart = start;
  window.__aymeRecorderGate?.set(start.on);
}

/**
 * Installs the gate in a document, switched on or off as `startGate` last
 * said, and off when it never did. Switched on, it holds back the click
 * that ends a press of the left mouse button and a key press that
 * Playwright records as a press, and tells the adapter through the binding
 * called `held`. Only the final click is held: the press and the release
 * reach the page as they come, so pressing, dragging and selecting text
 * behave as they do without it. Once it has held an input, and from the
 * moment it is switched on, it holds every key after it, typing included,
 * until it is let through: input reaches the page in the order it was
 * given. Switched off, it goes on holding keys and clicks alike while an
 * input it held still waits to be passed on.
 *
 * It listens on `window`, before anything of the page and before
 * Playwright's recorder, which listens on `document`: neither sees a held
 * input until the adapter sends it on.
 */
export function installGate(held: string): void {
  // Every document has its own, frames included: a frame's click is sent
  // on at its place in the page.
  if (window.__aymeRecorderGate) return;
  let on = window.__aymeRecorderGateStart?.on ?? false;
  let holding = on;
  // Names this document: a held input is sent on to no other.
  const thisDocument = `${Date.now()}:${Math.random()}`;
  /** How many inputs it held, and how many of those still wait. */
  let seq = 0;
  let waiting = 0;
  let passingOn:
    { x: number; y: number; detail: number; seen: Set<string> } | undefined;
  let passingKey: string | undefined;
  let swallowDoubleClick = false;
  /** Whether the person holds a mouse button down, and who waits for its
   * release. */
  let pressed = false;
  let released: (() => void) | undefined;
  /** The codes of held keys whose release is the gate's too. */
  const swallowKeyUp = new Set<string>();
  /** Playwright's recorder picks an element: inputs are left to it. */
  let picking = false;
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
    open: async (input, heldIn) => {
      if (heldIn !== thisDocument) return false;
      if ("code" in input) {
        passingKey = input.code;
        return true;
      }
      // A click sent on while the person holds the button down would end
      // their press: it waits for the release, a second at most.
      if (pressed)
        await new Promise<void>((resolve) => {
          released = resolve;
          setTimeout(resolve, 1_000);
        });
      released = undefined;
      passingOn = { ...input, seen: new Set() };
      return true;
    },
    close: () => {
      if (passingOn || passingKey) arrived();
      passingOn = undefined;
      passingKey = undefined;
    },
    letThrough: (upTo) => {
      if (seq <= upTo) holding = false;
    },
    pick: (on) => {
      picking = on;
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
    // The recorder's own toolbar: an input on it is no Interaction.
    target.nodeName === "AYME-RECORDER-TOOLBAR" ||
    target.nodeName === "SELECT" ||
    target.nodeName === "OPTION" ||
    (target instanceof HTMLInputElement && pickers.has(target.type));
  const swallow = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  const onMouse = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    if (picking) {
      // Playwright picks on this click, and goes back to recording.
      if (event.type === "click" && event.button === 0) picking = false;
      return;
    }
    // The click sent on is known by its place and its count, and brings one
    // event of each type: whatever else the person does meanwhile is
    // theirs, as the second press of a double click at the same place.
    if (
      passingOn &&
      Math.abs(event.clientX - passingOn.x) < 1 &&
      Math.abs(event.clientY - passingOn.y) < 1 &&
      !passingOn.seen.has(event.type) &&
      (event.type.startsWith("pointer") || event.detail === passingOn.detail)
    ) {
      passingOn.seen.add(event.type);
      // Its press and its release already reached the page once, from the
      // person: only its click is let through.
      if (event.type === "mousedown") swallow(event);
      else if (event.type === "click") {
        passingOn = undefined;
        arrived();
      } else event.stopImmediatePropagation();
      return;
    }
    if (event.type === "pointerdown") pressed = true;
    if (event.type === "pointerup") {
      pressed = false;
      released?.();
    }
    // Switched off, it goes on holding clicks, as it does keys, while an
    // input it held still waits to be passed on: a later click must not
    // reach the page before it.
    if (!on && !holding) return;
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
      document: thisDocument,
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
    if (picking) return;
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
      nothingFocused:
        event.composedPath()[0] === document.body ||
        event.composedPath()[0] === document.documentElement,
      key: event.key,
      code: event.code,
      modifiers: modifiersOf(event),
      document: thisDocument,
    });
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
}

/** What a document tells of an input's target: the refs Playwright's
 * recorder gave the target and each of its ancestors, nearest first, null
 * where it gave none. */
export type TargetChain = {
  readonly type: string;
  readonly chain: readonly (string | null)[];
};

/**
 * Installs the target watch in a document. Playwright's recorder takes its
 * picture of the page while it handles an input, and leaves each element it
 * lists tagged with its ref (`_ariaRef`, a private part of Playwright). Right
 * after it, this reads those tags off the target and its ancestors, through
 * open shadow roots, and tells them through the binding called `tell`: an
 * element the picture does not list is then known by its nearest ancestor
 * that it does.
 */
export function installTargetWatch(tell: string): void {
  const read = (event: Event) => {
    if (!event.isTrusted) return;
    const chain: (string | null)[] = [];
    for (
      let node: Node | null = event.composedPath()[0] as Node | null;
      node && node.nodeType === Node.ELEMENT_NODE;
      node =
        (node as Element).parentElement ??
        ((node.getRootNode() as ShadowRoot).host || null)
    )
      chain.push(
        (node as Element & { _ariaRef?: { ref?: string } })._ariaRef?.ref ??
          null
      );
    void (
      window as unknown as Record<string, (seen: TargetChain) => Promise<void>>
    )[tell]!({ type: event.type, chain });
  };
  // Playwright's recorder listens on the document as the event goes down;
  // a listener on the root element runs right after it.
  const install = () => {
    for (const type of ["click", "keydown", "input"])
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

/**
 * Takes away the mark Playwright's recorder leaves on the body when it
 * picks an element (`data-pw-cursor`, a private part of Playwright), as soon
 * as it is put there. Left there, it makes every element look clickable,
 * and the page's structure loses its marks of what is clickable.
 */
export function keepCursorsAsTheyAre(): void {
  const mark = "data-pw-cursor";
  const take = () => document.body?.removeAttribute(mark);
  new MutationObserver(take).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: [mark],
  });
  take();
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

/** Where the highlight is drawn, in the top document's viewport. */
export type HighlightBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Draws the recorder's own highlight over a box of the top document, in
 * place of the one drawn before, or takes it away when `box` is null. It is
 * not part of the page: hidden from the page's structure and from every
 * input, and drawn in a closed shadow root.
 */
export function drawHighlight(box: HighlightBox | null): void {
  const name = "ayme-recorder-highlight";
  document.querySelector(name)?.remove();
  if (!box) return;
  const host = document.createElement(name);
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position: fixed",
    `left: ${box.x}px`,
    `top: ${box.y}px`,
    `width: ${box.width}px`,
    `height: ${box.height}px`,
    "margin: 0",
    "padding: 0",
    "border: 0",
    "pointer-events: none",
    "z-index: 2147483647",
    "display: block",
  ].join(";");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML =
    "<div style='box-sizing: border-box; width: 100%; height: 100%; border: 2px solid #e5484d; border-radius: 3px; background: rgb(229 72 77 / 15%)'></div>";
  document.documentElement.append(host);
}
