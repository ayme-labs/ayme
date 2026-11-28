// The rules the recorder's page code decides by, as plain functions: they
// need no page, so Node tests and mutates them. A page function gets them
// as an argument, and `withRules` sends them into the page with it, so the
// page code itself only reads the page and calls them
// (docs/testing.md#code-a-real-browser-runs). Each uses nothing from outside
// itself but the rules and helpers sent with it.

export type Modifier = "Alt" | "Control" | "Meta" | "Shift";

/** Which held click an event is: the document that held it, and its number
 * there (`seq` of `HeldByPage`). */
export type HeldClick = { readonly document: string; readonly seq: number };

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
      /** The button, the left one when it is not said. */
      readonly button?: "right" | "middle";
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
 * private part of Playwright: the compatibility suite checks it per version.
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
  /** An input's type; empty for another element. */
  readonly inputType: string;
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
  ].includes(target.inputType);
}

/** The ref on the first line of a snapshot in Playwright's AI mode: its
 * top element's; none when the page structure does not list that one. */
export function ownRefOf(snapshot: string): string | undefined {
  const [first = ""] = snapshot.split("\n");
  return /\[ref=([^\]]+)\]/.exec(first)?.[1];
}

/** Whether an element is one the recorder puts in a page itself, which the
 * outline while picking leaves out: its toolbar, its highlight and the
 * outline. */
export function recordersOwn(localName: string): boolean {
  return localName.startsWith("ayme-recorder-");
}

/** Whether the gate holds a click back, on a target it does not leave
 * alone: the left button's click, with a count (a click with none is a
 * key's or a label's), the right button's context menu event, which
 * Playwright records a right-click by, and the middle button's auxclick,
 * which Playwright records a middle click by. A context menu a key opened
 * is the page's. */
export function clickHeld(click: {
  readonly type: string;
  readonly button: number;
  readonly detail: number;
  readonly target: ClickTarget;
}): boolean {
  if (leftAlone(click.target)) return false;
  if (click.type === "contextmenu") return click.button === 2;
  if (click.type === "auxclick") return click.button === 1;
  return click.button === 0 && click.detail !== 0;
}

/**
 * Whether a call from a page can reach Node through a Playwright binding.
 * Playwright writes every binding call with the page's own `JSON.stringify`,
 * so a page that replaced it, or that changed how it writes an object, as
 * Prototype.js 1.6 gives arrays a `toJSON`, sends a call Node cannot read:
 * it is lost, and so is every report of Playwright's recorder. The probe is
 * shaped as Playwright writes a call, and read back as a value, so text laid
 * out another way, or with more in it, still reads the same.
 */
export function reachesPlaywright(
  stringify: (value: unknown) => string,
  parse: (text: string) => unknown
): boolean {
  const call = {
    name: "__aymeRecorderHeld",
    seq: 1,
    serializedArgs: [
      {
        o: [
          { k: "kind", v: "click" },
          { k: "x", v: 1.5 },
          { k: "modifiers", v: { a: ["Shift"], id: 2 } },
        ],
        id: 1,
      },
    ],
  };
  let written: string;
  try {
    written = stringify(call);
  } catch {
    return false;
  }
  const readsBack = (text: string) => {
    let read: Record<string, unknown> | null | undefined;
    try {
      read = parse(text) as Record<string, unknown> | null;
    } catch {
      // Unreadable: nothing is read, and nothing is the call.
    }
    // The fields Playwright reads of a call.
    return (["name", "seq", "serializedArgs"] as const).every((field) =>
      sameJson(read?.[field], call[field])
    );
  };
  // A `parse` that cannot read the call's own text cannot tell, and the
  // page counts as heard: taking a healthy page for a broken one would keep
  // it from being recorded.
  return (
    readsBack(written) ||
    !readsBack(
      '{"name":"__aymeRecorderHeld","seq":1,"serializedArgs":[{"o":[{"k":"kind","v":"click"},{"k":"x","v":1.5},{"k":"modifiers","v":{"a":["Shift"],"id":2}}],"id":1}]}'
    )
  );
}

/** Whether two plain JSON values are the same. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) =>
    sameJson(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  );
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

/** The button of a click the gate holds, by the event it is held by: the
 * right one by its context menu event, the middle one by its auxclick, the
 * left one, not said, by its click. */
export function heldButton(type: string): "right" | "middle" | undefined {
  if (type === "contextmenu") return "right";
  return type === "auxclick" ? "middle" : undefined;
}

/** The event of a click sent on that reaches the page: the click, or the
 * context menu event of a right-click. */
export function arrivingEvent(button: "right" | "middle" | undefined): string {
  if (button === "middle") return "auxclick";
  return button === "right" ? "contextmenu" : "click";
}

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
  // A pointer event has no count, and browsers count a context menu
  // event apart.
  return (
    event.type.startsWith("pointer") ||
    event.type === "contextmenu" ||
    event.detail === passing.detail
  );
}

/** What becomes of an event of the click sent on. Its press and its release
 * already reached the page once, from the person: they are stopped, and
 * the press also cancelled; the event that `arrives` reaches the page, its
 * click or a right-click's context menu event. */
export function replayedEffect(
  type: string,
  arrives = "click"
): "swallow" | "stop" | "arrive" {
  if (type === "mousedown") return "swallow";
  return type === arrives ? "arrive" : "stop";
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
    .join("");
  const given = Object.entries(rules)
    .map(([name, rule]) => `${JSON.stringify(name)}: ${rule.name}`)
    .join(", ");
  const text = `function (arg) {\n${declared}\nreturn (${String(main)})(arg, { ${given} });\n}`;
  sent.toString = () => text;
  return sent;
}

/** Whether the gate of a new document starts on, or starts leaving the
 * picking click to Playwright: as the latest start of either said, and off
 * when none did. */
export function gateStartsOn(
  start: { readonly on: boolean } | undefined
): boolean {
  return start?.on ?? false;
}

/** What the gate does with a mouse event: leaves it alone, ends a pick,
 * lets the click it sends on through, only notes whether a button is held,
 * or handles a double click or a click. */
export type MouseRoute =
  "ignore" | "endPicking" | "passOn" | "noteOnly" | "doubleClick" | "click";

/**
 * The route of a mouse event. While Playwright's recorder picks an element,
 * inputs are its own: the left button's click ends the pick. Switched off,
 * the gate goes on holding clicks while an input it held still waits to be
 * passed on, so that a later click does not reach the page before it.
 */
export function mouseRoute(
  event: {
    readonly trusted: boolean;
    readonly type: string;
    readonly button: number;
  },
  gate: {
    readonly picking: boolean;
    /** The event is of the click the gate sends on (`replayed`). */
    readonly replayed: boolean;
    readonly on: boolean;
    readonly holding: boolean;
  }
): MouseRoute {
  if (!event.trusted) return "ignore";
  if (gate.picking)
    return event.type === "click" && event.button === 0
      ? "endPicking"
      : "ignore";
  if (gate.replayed) return "passOn";
  if (!gate.on && !gate.holding) return "noteOnly";
  if (event.type === "dblclick") return "doubleClick";
  // A right-click is held by its context menu event, a middle click by its
  // auxclick.
  return ["click", "contextmenu", "auxclick"].includes(event.type)
    ? "click"
    : "noteOnly";
}

/** What the gate does with a key event: leaves it alone, takes its release,
 * notes that the key it sent on arrived, or considers holding it. */
export type KeyRoute = "ignore" | "keyUp" | "arrived" | "consider";

/** The route of a key event. A modifier on its own, and a key that composes
 * text, change nothing on the page. */
export function keyRoute(
  event: {
    readonly trusted: boolean;
    readonly type: string;
    readonly key: string;
    readonly code: string;
    readonly composing: boolean;
  },
  gate: {
    readonly picking: boolean;
    /** The code of the key the gate sends on, if one is on its way. */
    readonly passingKey: string | undefined;
  }
): KeyRoute {
  if (!event.trusted || gate.picking) return "ignore";
  if (event.type === "keyup") return "keyUp";
  if (event.code === gate.passingKey) return "arrived";
  if (event.composing) return "ignore";
  return ["Shift", "Control", "Meta", "Alt", "Process"].includes(event.key)
    ? "ignore"
    : "consider";
}

/**
 * Whether the gate holds a key back, and whether it is typing. Switched on,
 * it holds a key Playwright records as a press; once it holds anything, it
 * holds every key after it, typing included.
 */
export function keyHeld(key: {
  readonly on: boolean;
  /** Playwright records the key as a press (`recordedAsPress`). */
  readonly press: boolean;
  readonly holding: boolean;
}): { readonly held: boolean; readonly typing: boolean } {
  const press = key.on && key.press;
  return { held: press || key.holding, typing: !press };
}

/** The elements a selector of Playwright's names for an input given to an
 * element inside them: links, buttons and the controls like them, as a CSS
 * selector. */
export function controlsSelector(): string {
  return "button,select,input,[role=button],[role=checkbox],[role=radio],a,[role=link]";
}

/** What is known of an element, and each element above it, for
 * `actedOnIndex`. */
export type ActedOnFacts = {
  /** An input, a text area, a select, or editable content. */
  readonly field: boolean;
  /** It matches `controlsSelector`. */
  readonly interactive: boolean;
  readonly visible: boolean;
};

/**
 * Which element an input given to the first of `path` acted on, as
 * Playwright's selector for it names it: the place in `path`, the element
 * under the pointer and each element above it, nearest first. Playwright
 * 1.64 names the nearest control around the element, a link or a button,
 * when it is visible, and a field itself; its own ref of the target is the
 * element under the pointer's, before it looks for that control, so the
 * recorder looks for it the same way.
 */
export function actedOnIndex(path: readonly ActedOnFacts[]): number {
  if (path.length === 0 || path[0]!.field) return 0;
  const control = path.findIndex((element) => element.interactive);
  return control >= 0 && path[control]!.visible ? control : 0;
}

/**
 * The refs of a node and each node above it, nearest first, null where a
 * node has none: `up` names the node above, `refOf` a node's ref.
 */
export function ancestorChain<N>(
  from: N | null,
  up: (node: N) => N | null,
  refOf: (node: N) => string | null
): (string | null)[] {
  const chain: (string | null)[] = [];
  for (let node = from; node !== null; node = up(node)) chain.push(refOf(node));
  return chain;
}

/**
 * Up to which of its held inputs a document's gate lets what follows
 * through: the last one that document held up to and with `upTo`, in the
 * order the page held them; 0, letting nothing it held after go first, when
 * it held none of them or `upTo` is null. `inDocument` says whether a held
 * input was held in that document.
 */
export function letThroughUpTo<
  I extends { readonly id: string; readonly seq: number },
>(
  known: readonly I[],
  upTo: string | null,
  inDocument: (input: I) => boolean
): number {
  const through = known.slice(
    0,
    known.findIndex((input) => input.id === upTo) + 1
  );
  return Math.max(0, ...through.filter(inDocument).map((input) => input.seq));
}

export type GateRules = {
  readonly recordedAsPress: typeof recordedAsPress;
  readonly keyTarget: typeof keyTarget;
  readonly clickHeld: typeof clickHeld;
  readonly modifiersOf: typeof modifiersOf;
  readonly replayed: typeof replayed;
  readonly replayedEffect: typeof replayedEffect;
  readonly arrivingEvent: typeof arrivingEvent;
  readonly heldButton: typeof heldButton;
  readonly gateStartsOn: typeof gateStartsOn;
  readonly mouseRoute: typeof mouseRoute;
  readonly keyRoute: typeof keyRoute;
  readonly keyHeld: typeof keyHeld;
  readonly reachesPlaywright: typeof reachesPlaywright;
};
