import type { HeldByPage, HeldClick, Modifier } from "./pageRules";
import type { InputNote } from "./reportTarget";

// What a page hands the adapter's page functions. Any script of the page can
// call them, with anything, so a value is taken only in the shape the
// adapter's own in-page code sends: another would throw in Node later, where
// nothing catches it.

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRefOrNull = (value: unknown) =>
  value === null || typeof value === "string";

const MODIFIERS: readonly unknown[] = [
  "Alt",
  "Control",
  "Meta",
  "Shift",
] satisfies Modifier[];

const isModifierList = (value: unknown) =>
  Array.isArray(value) && value.every((one) => MODIFIERS.includes(one));

const isHeldClick = (value: unknown): value is HeldClick =>
  isObject(value) &&
  typeof value.document === "string" &&
  typeof value.seq === "number";

/** Whether a value is an input the gate held, as it tells of one. */
export function isHeldByPage(value: unknown): value is HeldByPage {
  if (!isHeldClick(value)) return false;
  const input = value as Fields;
  if (!isModifierList(input.modifiers)) return false;
  return input.kind === "click"
    ? typeof input.x === "number" &&
        typeof input.y === "number" &&
        typeof input.detail === "number" &&
        (input.button === undefined ||
          input.button === "right" ||
          input.button === "middle")
    : input.kind === "key" &&
        typeof input.typing === "boolean" &&
        typeof input.nothingFocused === "boolean" &&
        typeof input.key === "string" &&
        typeof input.code === "string";
}

/** Whether a value is a note of an input's target, as the target watch
 * tells of one (the in-page `TargetChain`). */
export const isInputNote = (value: unknown): value is InputNote =>
  isObject(value) &&
  typeof value.type === "string" &&
  Array.isArray(value.chain) &&
  value.chain.every(isRefOrNull) &&
  isRefOrNull(value.under) &&
  (value.held === null || isHeldClick(value.held));
