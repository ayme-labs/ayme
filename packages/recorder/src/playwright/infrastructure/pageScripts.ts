/// <reference lib="dom" />

// What the adapter runs inside a recorded page. Each function is sent to
// the page as its own text, so it uses nothing from outside itself: no
// import, and no value of this module, but the rules `withRules` sends with
// it. Those rules need no page, and Node tests them; the rest runs only in
// the page, where Stryker's instrumentation would break it, so it is kept
// out of mutation (docs/testing.md#change-analysis).

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

// Stryker disable all: it runs only in the page.
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
// Stryker restore all

// The rules the gate decides by. They need no page: Node tests them, and
// `withRules` sends them into the page with the gate. Each uses nothing
// from outside itself but the rules sent with it.

/** What a key's target is, as the rule for a press tells them apart. */
export type KeyTarget = "input" | "textarea" | "contentEditable" | "other";

/** What the rule for a press reads off a key. `mac`: the page runs on a
 * Mac, where pasting is Meta+V. */
export type KeyFacts = {
  readonly key: string;
  readonly code: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly target: KeyTarget;
  readonly mac: boolean;
};

/**
 * Whether Playwright's recorder records a key as a press; otherwise it is
 * typing. A copy of `JsonRecordActionTool._shouldGenerateKeyPressFor`, a
 * private part of Playwright: the contract suite checks it per version.
 */
export function recordedAsPress(key: KeyFacts): boolean {
  if (key.key === "Enter")
    return key.target !== "textarea" && key.target !== "contentEditable";
  if (typingKey(key)) return false;
  // A character on its own is typing where text can be typed.
  if (key.key.length === 1 && !key.ctrl && !key.alt && !key.meta)
    return key.target === "other";
  return true;
}

/** The keys Playwright's recorder takes for typing, whatever they go to:
 * erasing, AltGraph, the @ of Alt+L, and pasting. */
export function typingKey(key: KeyFacts): boolean {
  if (["Backspace", "Delete", "AltGraph"].includes(key.key)) return true;
  if (key.key === "@" && key.code === "KeyL") return true;
  if (key.key === "v" && (key.mac ? key.meta : key.ctrl)) return true;
  return key.key === "Insert" && key.shift && !key.mac;
}

/** The kind of a key's target, from what the page says of it. */
export function keyTarget(
  target: {
    readonly nodeName: string;
    readonly isContentEditable: boolean;
  } | null
): KeyTarget {
  if (!target) return "other";
  if (target.nodeName === "TEXTAREA") return "textarea";
  if (target.isContentEditable) return "contentEditable";
  return target.nodeName === "INPUT" ? "input" : "other";
}

/** A click's target, as the gate reads it: null when it is no element. */
export type ClickTarget = {
  readonly nodeName: string;
  /** An input's type; null for another element. */
  readonly inputType: string | null;
} | null;

/** Whether the gate leaves a target's clicks to the page: the recorder's own
 * toolbar, and the native pickers Playwright's recorder leaves alone too. */
export function leftAlone(target: ClickTarget): boolean {
  if (!target) return true;
  if (["AYME-RECORDER-TOOLBAR", "SELECT", "OPTION"].includes(target.nodeName))
    return true;
  return [
    "color",
    "date",
    "datetime-local",
    "file",
    "month",
    "range",
    "time",
    "week",
  ].includes(target.inputType ?? "");
}

/** Whether the gate holds a click back: the left button's, with a count (a
 * click with none is a key's or a label's), on a target it does not leave
 * alone. */
export function clickHeld(click: {
  readonly button: number;
  readonly detail: number;
  readonly target: ClickTarget;
}): boolean {
  return click.button === 0 && click.detail !== 0 && !leftAlone(click.target);
}

/** The modifier keys held with an input, in a fixed order. */
export function modifiersOf(event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): Modifier[] {
  const held: Modifier[] = [];
  if (event.altKey) held.push("Alt");
  if (event.ctrlKey) held.push("Control");
  if (event.metaKey) held.push("Meta");
  if (event.shiftKey) held.push("Shift");
  return held;
}

/** The click the gate sends on, and the event types of it already seen. */
export type PassingOn = {
  readonly x: number;
  readonly y: number;
  readonly detail: number;
  readonly seen: readonly string[];
};

/**
 * Whether an event is of the click the gate sends on: at its place, within
 * a pixel, with its count, and of a type not seen of it yet. A pointer
 * event has no count. Whatever else the person does meanwhile is theirs,
 * as the second press of a double click at the same place.
 */
export function replayed(
  event: {
    readonly type: string;
    readonly x: number;
    readonly y: number;
    readonly detail: number;
  },
  passing: PassingOn | undefined
): boolean {
  if (!passing || passing.seen.includes(event.type)) return false;
  if (Math.abs(event.x - passing.x) >= 1) return false;
  if (Math.abs(event.y - passing.y) >= 1) return false;
  return event.type.startsWith("pointer") || event.detail === passing.detail;
}

/** What becomes of an event of the click sent on. Its press and its release
 * already reached the page once, from the person: they are stopped, and
 * the press also cancelled; its click arrives. */
export function replayedEffect(type: string): "swallow" | "stop" | "arrive" {
  if (type === "mousedown") return "swallow";
  return type === "click" ? "arrive" : "stop";
}

/**
 * A page function sent with the rules it uses. Called here, it runs with
 * them. Its text, which Playwright sends into the page, declares each rule,
 * and each helper the rules use, before it calls the function: in the page
 * it needs nothing of this module.
 */
export function withRules<
  A,
  T,
  R extends Record<string, (...args: never[]) => unknown>,
>(
  main: (arg: A, rules: R) => T,
  rules: R,
  helpers: readonly ((...args: never[]) => unknown)[] = []
): (arg: A) => T {
  const sent = (arg: A) => main(arg, rules);
  const declared = [...helpers, ...Object.values(rules)]
    .map((rule) => `const ${rule.name} = ${String(rule)};`)
    .join("\n");
  const given = Object.entries(rules)
    .map(([name, rule]) => `${JSON.stringify(name)}: ${rule.name}`)
    .join(", ");
  const text = `function (arg) {\n${declared}\nreturn (${String(main)})(arg, { ${given} });\n}`;
  sent.toString = () => text;
  return sent;
}

/** The rules the gate is sent with. */
type GateRules = {
  readonly recordedAsPress: typeof recordedAsPress;
  readonly keyTarget: typeof keyTarget;
  readonly clickHeld: typeof clickHeld;
  readonly modifiersOf: typeof modifiersOf;
  readonly replayed: typeof replayed;
  readonly replayedEffect: typeof replayedEffect;
};

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
export const installGate: (held: string) => void = withRules(
  gateIn,
  {
    recordedAsPress,
    keyTarget,
    clickHeld,
    modifiersOf,
    replayed,
    replayedEffect,
  },
  [leftAlone, typingKey]
);

// Stryker disable all: it runs only in the page.
function gateIn(held: string, rules: GateRules): void {
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
    { x: number; y: number; detail: number; seen: string[] } | undefined;
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
      passingOn = { ...input, seen: [] };
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
  const swallow = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const elementOf = (event: Event) => {
    const target = event.composedPath()[0];
    return target instanceof Element ? target : null;
  };
  const hold = (event: Event) => {
    swallow(event);
    holding = true;
    waiting += 1;
    seq += 1;
  };

  /** An event of the click sent on: only its click reaches the page. */
  const passOnEvent = (event: MouseEvent) => {
    passingOn!.seen.push(event.type);
    const effect = rules.replayedEffect(event.type);
    if (effect === "swallow") swallow(event);
    else if (effect === "stop") event.stopImmediatePropagation();
    else {
      passingOn = undefined;
      arrived();
    }
  };
  /** Whether the person holds a mouse button down. */
  const notePress = (event: MouseEvent) => {
    if (event.type === "pointerdown") pressed = true;
    if (event.type !== "pointerup") return;
    pressed = false;
    released?.();
  };
  /** The double click of a held second click comes back when that click
   * is sent on. */
  const onDoubleClick = (event: MouseEvent) => {
    if (swallowDoubleClick) swallow(event);
    swallowDoubleClick = false;
  };
  const onClick = (event: MouseEvent) => {
    const target = elementOf(event);
    const click = {
      button: event.button,
      detail: event.detail,
      target: target && {
        nodeName: target.nodeName,
        inputType: target instanceof HTMLInputElement ? target.type : null,
      },
    };
    if (!rules.clickHeld(click)) return;
    hold(event);
    swallowDoubleClick = event.detail >= 2;
    tell({
      kind: "click",
      seq,
      x: event.clientX,
      y: event.clientY,
      detail: event.detail,
      modifiers: rules.modifiersOf(event),
      document: thisDocument,
    });
  };
  const onMouse = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    if (picking) {
      // Playwright picks on this click, and goes back to recording.
      if (event.type === "click" && event.button === 0) picking = false;
      return;
    }
    const at = {
      type: event.type,
      x: event.clientX,
      y: event.clientY,
      detail: event.detail,
    };
    if (rules.replayed(at, passingOn)) return passOnEvent(event);
    notePress(event);
    // Switched off, it goes on holding clicks, as it does keys, while an
    // input it held still waits to be passed on: a later click must not
    // reach the page before it.
    if (!on && !holding) return;
    if (event.type === "dblclick") return onDoubleClick(event);
    if (event.type === "click") onClick(event);
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

  // A modifier on its own changes nothing on the page.
  const bare = new Set(["Shift", "Control", "Meta", "Alt", "Process"]);
  const pressOf = (event: KeyboardEvent) => {
    const target = elementOf(event);
    return rules.recordedAsPress({
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      target: rules.keyTarget(
        target && {
          nodeName: target.nodeName,
          isContentEditable:
            target instanceof HTMLElement && target.isContentEditable,
        }
      ),
      mac: navigator.platform.includes("Mac"),
    });
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (swallowKeyUp.delete(event.code)) swallow(event);
  };
  const holdKey = (event: KeyboardEvent) => {
    const press = on && pressOf(event);
    if (!press && !holding) return;
    hold(event);
    swallowKeyUp.add(event.code);
    const target = event.composedPath()[0];
    tell({
      kind: "key",
      seq,
      typing: !press,
      nothingFocused:
        target === document.body || target === document.documentElement,
      key: event.key,
      code: event.code,
      modifiers: rules.modifiersOf(event),
      document: thisDocument,
    });
  };
  const onKey = (event: KeyboardEvent) => {
    if (!event.isTrusted || picking) return;
    if (event.type === "keyup") return onKeyUp(event);
    if (passingKey !== undefined && event.code === passingKey) {
      passingKey = undefined;
      return arrived();
    }
    if (bare.has(event.key) || event.isComposing) return;
    holdKey(event);
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
}
// Stryker restore all

// Stryker disable all: what follows runs only in the page.
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
// Stryker restore all
