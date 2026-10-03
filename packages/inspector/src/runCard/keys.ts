/**
 * The keys `press_key` takes, as Playwright names them: one key, or
 * modifiers then a key joined by `+`, e.g. `ControlOrMeta+Shift+K`. The
 * names are those of Playwright's US keyboard layout.
 */

/** The modifiers Playwright holds before the key, as a key field records them. */
const recordedModifiers = ["ControlOrMeta", "Alt", "Shift"] as const;

const modifiers = new Set([
  "ControlOrMeta",
  ...["Shift", "Control", "Alt", "Meta"].flatMap((name) => [
    name,
    `${name}Left`,
    `${name}Right`,
  ]),
]);

/** Every key name of more than one character: the layout's codes and modifiers. */
const names = [
  ...["Enter", "Tab", "Escape", "Backspace", "Delete", "Space"],
  ...["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  ...["Home", "End", "PageUp", "PageDown", "Insert"],
  ...Array.from({ length: 12 }, (_, at) => `F${at + 1}`),
  ...["ControlOrMeta", "Shift", "Control", "Alt", "Meta"],
  ...[...modifiers].filter((name) => /(Left|Right)$/.test(name)),
  "AltGraph",
  ...["CapsLock", "NumLock", "ScrollLock", "PrintScreen", "Pause"],
  "ContextMenu",
  ...["Numpad0", "Numpad1", "Numpad2", "Numpad3", "Numpad4"],
  ...["Numpad5", "Numpad6", "Numpad7", "Numpad8", "Numpad9"],
  ...["NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide"],
  ...["NumpadDecimal", "NumpadEnter"],
  ...["AudioVolumeUp", "AudioVolumeDown", "AudioVolumeMute"],
  ...["MediaPlayPause", "MediaTrackNext", "MediaTrackPrevious"],
  ...["Backquote", "Minus", "Equal", "Backslash", "BracketLeft"],
  ...["BracketRight", "Semicolon", "Quote", "Comma", "Period", "Slash"],
  ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `Key${letter}`),
  ...[..."0123456789"].map((digit) => `Digit${digit}`),
];

/** The characters a key of the layout types, each a key name of its own. */
const characters = new Set(
  "`~1!2@3#4$5%6^7&8*9(0)-_=+\\|qQwWeErRtTyYuUiIoOpP[{]}aAsSdDfFgGhHjJkKlL;:'\"zZxXcCvVbBnNmM,<.>/? "
);

/** Spellings people type for a key, by lower case, and the key they mean. */
const aliases: Readonly<Record<string, string>> = {
  ctrl: "ControlOrMeta",
  cmd: "ControlOrMeta",
  command: "ControlOrMeta",
  mod: "ControlOrMeta",
  "⌘": "ControlOrMeta",
  win: "Meta",
  super: "Meta",
  option: "Alt",
  opt: "Alt",
  "⌥": "Alt",
  esc: "Escape",
  del: "Delete",
  return: "Enter",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pgup: "PageUp",
  pgdn: "PageDown",
  spacebar: "Space",
  bksp: "Backspace",
  ins: "Insert",
};

const byLowerCase = new Map(names.map((name) => [name.toLowerCase(), name]));

/** A key press as a key string, e.g. `ControlOrMeta+C`, `A` or `Shift+Tab`. */
export function keyOfEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >
): string {
  const chord = event.ctrlKey || event.metaKey || event.altKey;
  // In a combo a letter or digit is the key itself, not what ⌥ or Shift
  // composes from it; on its own it's the character as typed.
  const fromCode = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code);
  const key =
    chord && fromCode
      ? (fromCode[1] ?? fromCode[2])!
      : event.key === " "
        ? "Space"
        : event.key;
  const held = [
    (event.ctrlKey || event.metaKey) && "ControlOrMeta",
    event.altKey && "Alt",
    // A character typed with Shift already carries it, e.g. "A" or "!".
    event.shiftKey && (chord || key.length > 1) && "Shift",
  ].filter(Boolean);
  return [...held, key].join("+");
}

/** The modifier a key holds, as a key field records it, if it's one. */
export function modifierOf(key: string) {
  if (key === "Control" || key === "Meta") return "ControlOrMeta";
  if (key === "Alt" || key === "Shift") return key;
}

/** Modifiers pressed on their own, e.g. `Shift` or `ControlOrMeta+Shift`. */
export function modifiersOnly(held: readonly string[]) {
  return recordedModifiers.filter((name) => held.includes(name)).join("+");
}

/** The parts of a key string, split the way Playwright splits it. */
function partsOf(text: string) {
  const parts: string[] = [];
  let part = "";
  for (const character of text)
    if (character === "+" && part) {
      parts.push(part);
      part = "";
    } else part += character;
  parts.push(part);
  return parts;
}

/** A part as Playwright names it, or undefined when it names no key. */
function nameOf(part: string) {
  if (characters.has(part) || names.includes(part)) return part;
  const lower = part.toLowerCase();
  return aliases[lower] ?? byLowerCase.get(lower);
}

export type KeyCheck =
  /** `value` is what Playwright takes; empty for no key. */
  | { ok: true; value: string }
  /** `fix` is the closest key string, when there's one. */
  | { ok: false; problem: string; fix?: string };

/**
 * Checks a typed key string, e.g. `ctrl+c`, and gives it as Playwright names
 * it, e.g. `ControlOrMeta+C`.
 */
export function checkKey(text: string): KeyCheck {
  const typed = text.trim();
  if (!typed) return { ok: true, value: "" };
  const parts = partsOf(typed);
  const named: string[] = [];
  for (const [at, part] of parts.entries()) {
    if (!part) return { ok: false, problem: "Add a key after the +." };
    const name = nameOf(part);
    if (!name) {
      const guess = closestName(part);
      const fixed = guess && checkKey(parts.with(at, guess).join("+"));
      return {
        ok: false,
        problem: `“${part}” isn't a key name.`,
        ...(fixed && fixed.ok ? { fix: fixed.value } : {}),
      };
    }
    if (at < parts.length - 1 && !modifiers.has(name))
      return {
        ok: false,
        problem: `Only modifiers can come before +, and ${name} isn't one.`,
      };
    named.push(name);
  }
  const key = named.pop()!;
  // A combo takes a letter in upper case, as recording gives it.
  const chord = named.some((name) => !name.startsWith("Shift"));
  return {
    ok: true,
    value: [
      ...named,
      chord && /^[a-z]$/.test(key) ? key.toUpperCase() : key,
    ].join("+"),
  };
}

/** The key name closest to a misspelt one, when one is close enough. */
function closestName(part: string) {
  const lower = part.toLowerCase();
  const candidates = [...byLowerCase, ...Object.entries(aliases)];
  let best: string | undefined;
  let bestDistance = Math.max(1, Math.floor(lower.length / 3)) + 1;
  for (const [spelling, name] of candidates) {
    const distance = editDistance(lower, spelling);
    if (distance < bestDistance) [best, bestDistance] = [name, distance];
  }
  return best;
}

function editDistance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (const [i, x] of [...a].entries()) {
    const next = [i + 1];
    for (const [j, y] of [...b].entries())
      next.push(
        Math.min(row[j + 1]! + 1, next[j]! + 1, row[j]! + (x === y ? 0 : 1))
      );
    row = next;
  }
  return row[b.length]!;
}

/** What the search lists before anything is typed. */
const common = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "ArrowDown",
  "ArrowUp",
  "ControlOrMeta",
  "Shift",
];

/** Codes the search leaves out: their characters are listed instead. */
const characterCode = /^(Key[A-Z]|Digit\d)$/;

/**
 * Key names for the part being typed, after the modifiers already typed:
 * `value` is the field's text once one is chosen, ending in `+` for a
 * modifier so the rest of the combo can follow.
 */
export function suggestKeys(text: string): { value: string; label: string }[] {
  const parts = partsOf(text.trimStart());
  const typed = parts.pop()!.trim();
  const before = parts.map((part) => nameOf(part.trim()) ?? part.trim());
  const prefix = before.map((part) => `${part}+`).join("");
  const query = typed.toLowerCase();
  const pool = query
    ? names.filter((name) => !characterCode.test(name))
    : common;
  const starts = pool.filter((name) => name.toLowerCase().startsWith(query));
  const contains = pool.filter(
    (name) => !starts.includes(name) && name.toLowerCase().includes(query)
  );
  const exact = typed && nameOf(typed);
  const chord = before.some((name) => !name.startsWith("Shift"));
  const found = [
    ...(exact
      ? [chord && /^[a-z]$/.test(exact) ? exact.toUpperCase() : exact]
      : []),
    ...starts,
    ...contains,
  ];
  return [...new Set(found)]
    .filter((name) => !before.includes(name))
    .slice(0, 8)
    .map((name) => ({
      label: `${prefix}${name}`,
      value: `${prefix}${name}${modifiers.has(name) ? "+" : ""}`,
    }));
}
