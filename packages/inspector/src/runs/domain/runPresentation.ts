import type { ChildRun, RunInteraction, ToolArguments } from "./run";

const elementTools = new Set([
  "click",
  "hover",
  "type",
  "fill",
  "check",
  "uncheck",
  "select_option",
  "press_key",
]);

/** One browser input reads as one action; custom and multi-input tools keep their steps. */
export function runPresentation(run: ChildRun): {
  primary?: RunInteraction;
  arguments: ToolArguments;
} {
  const primary =
    elementTools.has(run.toolName) && run.interactions.length <= 1
      ? (run.interactions[0] ??
        (typeof run.arguments.target === "string"
          ? { operation: run.toolName, locator: run.arguments.target }
          : run.toolName === "press_key" &&
              typeof run.arguments.key === "string"
            ? { operation: run.toolName, value: run.arguments.key }
            : undefined))
      : undefined;
  const args = { ...run.arguments };
  if (
    primary ||
    (elementTools.has(run.toolName) &&
      run.interactions.some(({ locator }) => locator !== undefined))
  ) {
    delete args.target;
    if (run.interactions.some(({ value }) => args.text === value))
      delete args.text;
  }
  if (primary?.value === args.key) delete args.key;
  if (run.item?.ref === args.ref) delete args.ref;
  return { primary, arguments: args };
}
