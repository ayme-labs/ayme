// press_key's key check: whether a key is one Playwright's keyboard presses,
// from its US keyboard layout (Playwright's `server/usKeyboardLayout`, as the
// pinned `server/input.ts` reads it), without pressing anything. A plain
// function, so the check runs in Node as in the browser.

/** The named keys of the layout, with its aliases: `Enter` also answers to a line feed. */
const NAMED_KEYS = new Set(
  [
    "ControlOrMeta",
    "Escape F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12 Backquote Digit1 Digit2",
    "Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal",
    "Backslash Backspace Tab KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP",
    "BracketLeft BracketRight CapsLock KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK",
    "KeyL Semicolon Quote Enter ShiftLeft Shift KeyZ KeyX KeyC KeyV KeyB KeyN",
    "KeyM Comma Period Slash ShiftRight ControlLeft Control MetaLeft Meta",
    "AltLeft Alt Space AltRight AltGraph MetaRight ContextMenu ControlRight",
    "PrintScreen ScrollLock Pause PageUp PageDown Insert Delete Home End",
    "ArrowLeft ArrowUp ArrowRight ArrowDown AudioVolumeMute AudioVolumeDown",
    "AudioVolumeUp MediaTrackNext MediaTrackPrevious MediaPlayPause NumLock",
    "NumpadDivide NumpadMultiply NumpadSubtract Numpad7 Numpad8 Numpad9 Numpad4",
    "Numpad5 Numpad6 NumpadAdd Numpad1 Numpad2 Numpad3 Numpad0 NumpadDecimal",
    "NumpadEnter",
  ]
    .join(" ")
    .split(" ")
);

/** The characters the layout types, the shifted ones and the space included. */
const CHARACTERS = new Set(
  "`~1!2@3#4$5%6^7&8*9(0)-_=+\\|qQwWeErRtTyYuUiIoOpP[{]}aAsSdDfFgGhHjJkKlL;:'\"\n\rzZxXcCvVbBnNmM,<.>/? "
);

/** The keys that may come before the pressed one in a shortcut: `Shift+A`. */
const MODIFIERS = new Set([
  "Alt",
  "AltLeft",
  "AltRight",
  "Control",
  "ControlLeft",
  "ControlRight",
  "ControlOrMeta",
  "Meta",
  "MetaLeft",
  "MetaRight",
  "Shift",
  "ShiftLeft",
  "ShiftRight",
]);

function isLayoutKey(key: string): boolean {
  return NAMED_KEYS.has(key) || CHARACTERS.has(key);
}

/**
 * A shortcut's keys: split at each `+` that follows a key, so `+` alone and
 * `Control++` are keys of their own; undefined when one is empty.
 */
function splitShortcut(shortcut: string): string[] | undefined {
  const keys: string[] = [];
  let building = "";
  for (const character of shortcut) {
    if (character === "+" && building) {
      keys.push(building);
      building = "";
    } else building += character;
  }
  keys.push(building);
  return keys.some((key) => !key) ? undefined : keys;
}

/**
 * Whether `key` is a key name or a character Playwright's keyboard presses,
 * alone or as a shortcut such as `Control+A`: every key before the last is a
 * modifier, the last is on the layout.
 */
export function isPressableKey(key: string): boolean {
  const keys = splitShortcut(key);
  if (!keys) return false;
  return (
    keys.slice(0, -1).every((modifier) => MODIFIERS.has(modifier)) &&
    isLayoutKey(keys.at(-1)!)
  );
}
