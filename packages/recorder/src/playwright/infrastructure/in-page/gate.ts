/// <reference lib="dom" />

import type {
  GateRules,
  HeldByPage,
  HeldClick,
  KeyFacts,
  KeyRoute,
  MouseRoute,
} from "../pageRules";

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
   * the viewport, with the number the gate gave it, or the key with this
   * code. Lets it through; the gate closes again by itself when it has
   * arrived. Resolves when the input may be sent, as a click waits while
   * the person holds a mouse button down: to false, letting nothing
   * through, when the input was held in another document: that one is
   * gone. */
  open(
    input:
      | {
          x: number;
          y: number;
          detail: number;
          button?: "right" | "middle";
          seq: number;
        }
      | { code: string },
    document: string
  ): Promise<boolean>;
  /** Closes the gate after an input that never arrived. */
  close(): void;
  /** Lets what follows through, unless the document held an input after
   * the `upTo`th. */
  letThrough(upTo: number): void;
  /** The held click an event is, as it reached the page once sent on; null
   * for an event that is no held click's. */
  heldClickOf(event: Event): HeldClick | null;
  /** Leaves every input alone while Playwright's recorder picks an element,
   * or no longer: the picking click is Playwright's, and never reaches the
   * page. It stops by itself after the picking click. */
  pick(on: boolean): void;
};

/** Why a gate left an input to the page: Playwright would not hear the
 * document's calls, or the adapter did not take this one. */
type Unheard = "unheard" | "refused";

/** Whether a document's gate starts on, and the change that said so. */
export type GateStart = { readonly on: boolean; readonly change: number };

declare global {
  interface Window {
    __aymeRecorderGate?: Gate;
    __aymeRecorderGateStart?: GateStart;
    /** The latest start of Playwright's picking a document heard of
     * (`startPicking`). */
    __aymeRecorderPickingStart?: GateStart;
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
 * input it held still waits to be passed on. It keeps holding an input
 * only once the adapter answers that it took it, since nothing else would
 * ever let it through: where Playwright would not hear the call
 * (`reachesPlaywright`) it holds nothing, and where the call is rejected or
 * answered otherwise it sends the input on itself. It says so once on the
 * console, which reaches Node without the page's JSON.
 *
 * It listens on `window`, before anything of the page and before
 * Playwright's recorder, which listens on `document`: neither sees a held
 * input until the adapter sends it on.
 */
export function gateIn(held: string, rules: GateRules): void {
  // Every document has its own, frames included: a frame's click is sent
  // on at its place in the page.
  if (window.__aymeRecorderGate) return;
  // Taken as the document starts, before its own scripts could replace
  // them; a document that was loaded before the recorder attached may have.
  const parse = JSON.parse;
  const note = console.debug.bind(console);
  let on = rules.gateStartsOn(window.__aymeRecorderGateStart);
  let holding = on;
  // Names this document: a held input is sent on to no other.
  const thisDocument = `${Date.now()}:${Math.random()}`;
  /** How many inputs it held, and how many of those still wait. */
  let seq = 0;
  let waiting = 0;
  let passingOn:
    | {
        x: number;
        y: number;
        detail: number;
        /** The number the gate gave it. */
        seq: number;
        seen: string[];
        arrives: string;
        /** Its event reached the page; what follows of it is stopped until
         * it is closed, as a right-click's release after its context menu
         * event. */
        done?: boolean;
      }
    | undefined;
  let passingKey: string | undefined;
  let swallowDoubleClick = false;
  /** Whether the person holds a mouse button down, and who waits for its
   * release. */
  let pressed = false;
  let released: (() => void) | undefined;
  /** The codes of held keys whose release is the gate's too. */
  const swallowKeyUp = new Set<string>();
  /** The events of held clicks that reached the page, with the number of
   * each click. */
  const arrivals = new WeakMap<Event, number>();
  /** Playwright's recorder picks an element: inputs are left to it. */
  // Picking started before this script ran, if the start did.
  let picking = rules.gateStartsOn(window.__aymeRecorderPickingStart);
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
      // The button is checked once, on purpose. A press that comes after
      // this check and is still down when the click is sent on is ended by
      // the click's re-sent release, so a double click can reach the page
      // as a single click: the second click and the `dblclick` never
      // happen. Two fixes were rejected: holding each single click for the
      // person's double-click interval, which would slow every click; and
      // holding the person's press while a click waits, which would hold
      // presses and drags, which the gate leaves alone now unless one
      // matches the click it sends on (`replayed` in pageRules.ts).
      if (pressed)
        await new Promise<void>((resolve) => {
          released = resolve;
          setTimeout(resolve, 1_000);
        });
      released = undefined;
      passingOn = {
        x: input.x,
        y: input.y,
        detail: input.detail,
        seq: input.seq,
        seen: [],
        arrives: rules.arrivingEvent(input.button),
      };
      return true;
    },
    close: () => {
      if ((passingOn && !passingOn.done) || passingKey) arrived();
      passingOn = undefined;
      passingKey = undefined;
    },
    letThrough: (upTo) => {
      if (seq <= upTo) holding = false;
    },
    pick: (on) => {
      picking = on;
    },
    heldClickOf: (event) => {
      const seq = arrivals.get(event);
      return seq === undefined ? null : { document: thisDocument, seq };
    },
  };
  const heard = () =>
    rules.reachesPlaywright((value) => JSON.stringify(value), parse);
  /** Tells the adapter of an input it is about to hold, and has `release`
   * send it on unless the adapter answers that it took it. False when
   * Playwright would not hear the call, or it could not be made: nothing is
   * held then. */
  const tell = (input: HeldByPage, release: () => void) => {
    if (!heard()) return false;
    let answer: Promise<unknown>;
    try {
      answer = (
        window as unknown as Record<
          string,
          (input: HeldByPage) => Promise<unknown>
        >
      )[held]!(input);
    } catch {
      return false;
    }
    void answer.then(
      (taken) => taken === true || release(),
      () => release()
    );
    return true;
  };
  const swallow = (event: Event) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  const elementOf = (event: Event) => {
    const target = event.composedPath()[0];
    return target instanceof Element ? target : null;
  };
  const told: Partial<Record<Unheard, true>> = {};
  /** Says once why the gate left an input to the page. */
  const unheard = (why: Unheard) => {
    if (!told[why]) note(held, why, location.href);
    told[why] = true;
  };
  /** Sends on an input the adapter did not take, as `send` makes it. */
  const letGo = (send: () => void) => {
    arrived();
    unheard("refused");
    send();
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
    const effect = rules.replayedEffect(event.type, passingOn!.arrives);
    if (effect === "swallow") return swallow(event);
    if (effect === "stop") return event.stopImmediatePropagation();
    // It reaches the page: the target watch notes which held click it is.
    arrivals.set(event, passingOn!.seq);
    if (passingOn!.arrives === "click") passingOn = undefined;
    // A right-click's context menu event can come on its press: its
    // release is still to come, and is stopped too.
    else passingOn!.done = true;
    arrived();
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
  /** What the click rules are told of a click's target. */
  const clickTarget = (event: MouseEvent) => {
    const target = elementOf(event);
    return (
      target && {
        nodeName: target.nodeName,
        inputType: target instanceof HTMLInputElement ? target.type : "",
      }
    );
  };
  /** Tells of a held click: a right-click, held by its context menu event,
   * counts one. */
  /** A held click sent on as an event the gate makes: the page gets its
   * events, as a click its own script makes. */
  const resendClick = (event: MouseEvent, target: EventTarget) => () => {
    target.dispatchEvent(new MouseEvent(event.type, event));
    if (event.type === "click" && event.detail >= 2)
      target.dispatchEvent(new MouseEvent("dblclick", event));
  };
  const tellClick = (event: MouseEvent) => {
    const button = rules.heldButton(event.type);
    const target = event.composedPath()[0]!;
    return tell(
      {
        kind: "click",
        seq: seq + 1,
        x: event.clientX,
        y: event.clientY,
        detail: button ? 1 : event.detail,
        ...(button ? { button } : {}),
        modifiers: rules.modifiersOf(event),
        document: thisDocument,
      },
      () => letGo(resendClick(event, target))
    );
  };
  const onClick = (event: MouseEvent) => {
    notePress(event);
    const click = {
      type: event.type,
      button: event.button,
      detail: event.detail,
      target: clickTarget(event),
    };
    if (!rules.clickHeld(click)) return;
    if (!tellClick(event)) return unheard("unheard");
    hold(event);
    swallowDoubleClick = event.type === "click" && event.detail >= 2;
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
    "contextmenu",
    "auxclick",
  ] as const)
    window.addEventListener(type, onMouse as EventListener, true);

  const factsOf = (event: KeyboardEvent) => {
    const target = elementOf(event);
    return {
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
    };
  };
  /** A held key sent on as events the gate makes, typed into its field
   * when it is a character (`releasedAsText`), and released unless its own
   * release is still to come. */
  const resendKey =
    (event: KeyboardEvent, target: EventTarget, facts: KeyFacts) => () => {
      const typed = target.dispatchEvent(new KeyboardEvent("keydown", event));
      if (typed && rules.releasedAsText(facts))
        document.execCommand("insertText", false, event.key);
      if (!swallowKeyUp.delete(event.code))
        target.dispatchEvent(new KeyboardEvent("keyup", event));
    };
  const nothingFocused = (event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    return target === document.body || target === document.documentElement;
  };
  const holdKey = (event: KeyboardEvent) => {
    const facts = factsOf(event);
    const press = rules.recordedAsPress(facts);
    const decided = rules.keyHeld({ on, press, holding });
    if (!decided.held) return;
    const target = event.composedPath()[0]!;
    const told = tell(
      {
        kind: "key",
        seq: seq + 1,
        typing: decided.typing,
        nothingFocused: nothingFocused(event),
        key: event.key,
        code: event.code,
        modifiers: rules.modifiersOf(event),
        document: thisDocument,
      },
      () => letGo(resendKey(event, target, facts))
    );
    if (!told) return unheard("unheard");
    hold(event);
    swallowKeyUp.add(event.code);
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
