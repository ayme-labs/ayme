/// <reference lib="dom" />

import type { GateRules, HeldByPage, KeyRoute, MouseRoute } from "../pageRules";

// The gate, as it runs inside a recorded page. Each function is sent to the
// page as its own text, so it uses nothing from outside itself but what it
// is given: the rules it decides by come as an argument (`withRules`). It
// only reads the page and acts on what a rule decided
// (docs/testing.md#code-a-real-browser-runs).

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

/** Whether a document's gate starts on, and the change that said so. */
export type GateStart = { readonly on: boolean; readonly change: number };

declare global {
  interface Window {
    __aymeRecorderGate?: Gate;
    __aymeRecorderGateStart?: GateStart;
  }
}

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
export function gateIn(held: string, rules: GateRules): void {
  // Every document has its own, frames included: a frame's click is sent
  // on at its place in the page.
  if (window.__aymeRecorderGate) return;
  let on = rules.gateStartsOn(window.__aymeRecorderGateStart);
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
    notePress(event);
    if (swallowDoubleClick) swallow(event);
    swallowDoubleClick = false;
  };
  const onClick = (event: MouseEvent) => {
    notePress(event);
    const target = elementOf(event);
    const click = {
      button: event.button,
      detail: event.detail,
      target: target && {
        nodeName: target.nodeName,
        inputType: target instanceof HTMLInputElement ? target.type : "",
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
  const mouseRoutes: Record<MouseRoute, (event: MouseEvent) => void> = {
    ignore: () => {},
    // Playwright picks on this click, and goes back to recording.
    endPicking: () => {
      picking = false;
    },
    passOn: passOnEvent,
    noteOnly: notePress,
    doubleClick: onDoubleClick,
    click: onClick,
  };
  const onMouse = (event: MouseEvent) => {
    const at = {
      type: event.type,
      x: event.clientX,
      y: event.clientY,
      detail: event.detail,
    };
    mouseRoutes[
      rules.mouseRoute(
        { trusted: event.isTrusted, type: event.type, button: event.button },
        { picking, replayed: rules.replayed(at, passingOn), on, holding }
      )
    ](event);
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
  /** The key went to the document itself: no element had focus. */
  const nothingFocused = (event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    return target === document.body || target === document.documentElement;
  };
  const holdKey = (event: KeyboardEvent) => {
    const decided = rules.keyHeld({ on, press: pressOf(event), holding });
    if (!decided.held) return;
    hold(event);
    swallowKeyUp.add(event.code);
    tell({
      kind: "key",
      seq,
      typing: decided.typing,
      nothingFocused: nothingFocused(event),
      key: event.key,
      code: event.code,
      modifiers: rules.modifiersOf(event),
      document: thisDocument,
    });
  };
  const keyRoutes: Record<KeyRoute, (event: KeyboardEvent) => void> = {
    ignore: () => {},
    keyUp: (event) => {
      if (swallowKeyUp.delete(event.code)) swallow(event);
    },
    arrived: () => {
      passingKey = undefined;
      arrived();
    },
    consider: holdKey,
  };
  const onKey = (event: KeyboardEvent) =>
    keyRoutes[
      rules.keyRoute(
        {
          trusted: event.isTrusted,
          type: event.type,
          key: event.key,
          code: event.code,
          composing: event.isComposing,
        },
        { picking, passingKey }
      )
    ](event);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
}
