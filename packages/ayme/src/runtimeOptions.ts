import type { AymeOptions } from "./runtime";

/** What the `inspector` option turns on: nothing, the Inspector, or its demo too. */
export function inspectorMode({ inspector }: AymeOptions) {
  if (!inspector) return "off";
  return inspector !== true && inspector.demo ? "demo" : "on";
}

/**
 * Whether two option objects configure the same runtime session: every option
 * is the same value, `webMCP` has the same fields, and `inspector` turns on
 * the same. The framework owners use it to keep their options fixed while
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
    if (key === "inspector") return inspectorMode(a) === inspectorMode(b);
    if (key === "agentConnection")
      return (
        JSON.stringify(a.agentConnection) === JSON.stringify(b.agentConnection)
      );
    return a[key as keyof AymeOptions] === b[key as keyof AymeOptions];
  });
}
