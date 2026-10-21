import type { AymeOptions } from "./runtime";

/** What the `inspector` option turns on: nothing, the Inspector, or its demo too. */
export function inspectorMode({ inspector }: AymeOptions) {
  if (!inspector) return "off";
  return inspector !== true && inspector.demo ? "demo" : "on";
}

/**
 * Whether two option objects configure the same runtime session: every option
 * is the same value, `webMCP` has the same fields, `inspector` turns on the
 * same, and `customTools` and `pageObjects` list the same values in order. The framework owners use it to keep their options fixed while
 * mounted.
 */
export function sameRuntimeOptions(a: AymeOptions, b: AymeOptions) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => {
    if (key === "webMCP")
      return (
        a.webMCP?.enabled === b.webMCP?.enabled &&
        a.webMCP?.toolNamePrefix === b.webMCP?.toolNamePrefix
      );
    if (key === "customTools" || key === "pageObjects")
      return sameItems(a[key], b[key]);
    if (key === "inspector") return inspectorMode(a) === inspectorMode(b);
    if (key === "agentConnection")
      return (
        JSON.stringify(a.agentConnection) === JSON.stringify(b.agentConnection)
      );
    return a[key as keyof AymeOptions] === b[key as keyof AymeOptions];
  });
}

function sameItems(a?: readonly unknown[], b?: readonly unknown[]) {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
