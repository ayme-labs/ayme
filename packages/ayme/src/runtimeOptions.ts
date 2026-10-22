import type { AymeOptions } from "./runtime";

/** What the `inspector` option turns on: nothing, the Inspector, or its demo too. */
export function inspectorMode({ inspector }: AymeOptions) {
  if (!inspector) return "off";
  return inspector !== true && inspector.demo ? "demo" : "on";
}

/**
 * A copy of the options that `sameRuntimeOptions` can later trust: every
 * list and plain object is copied one level deep, the depth the comparison
 * reads, so a change the caller makes to one in place shows as a change. The
 * framework owners keep it while mounted.
 */
export function snapshotRuntimeOptions(options: AymeOptions): AymeOptions {
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [key, copy(value)])
  );
}

/**
 * Whether two option objects configure the same runtime session: `inspector`
 * turns on the same, and every other option holds the same values one level
 * deep, lists item by item in order and plain objects field by field. The
 * framework owners use it to keep their options fixed while mounted.
 */
export function sameRuntimeOptions(a: AymeOptions, b: AymeOptions) {
  return sameFields(a, b, (key) =>
    key === "inspector"
      ? inspectorMode(a) === inspectorMode(b)
      : sameValue(a[key], b[key])
  );
}

function copy(value: unknown) {
  if (Array.isArray(value)) return [...value];
  return isObject(value) ? { ...value } : value;
}

function sameValue(a: unknown, b: unknown) {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, index) => item === b[index]);
  if (isObject(a) && isObject(b))
    return sameFields(a, b, (key) => a[key] === b[key]);
  return a === b;
}

function sameFields<T extends object>(
  a: T,
  b: T,
  same: (key: keyof T) => boolean
) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => same(key as keyof T));
}

// Only plain objects: an instance's fields may live on its prototype, which a
// spread would drop, so instances stay by reference.
function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
