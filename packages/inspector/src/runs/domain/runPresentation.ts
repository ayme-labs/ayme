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
  value?: string | readonly string[];
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
  let value: string | readonly string[] | undefined = primary?.value;
  if (
    primary &&
    run.toolName === "select_option" &&
    Array.isArray(args.values) &&
    args.values.every((option) => typeof option === "string")
  ) {
    value = args.values;
    delete args.values;
  }
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
  if (run.toolName === "fill_form" && Array.isArray(args.fields)) {
    // One input per field, in order; a failed tail keeps its unresolved targets.
    args.fields = args.fields.map((field, index) => {
      const interaction = run.interactions[index];
      if (
        !field ||
        typeof field !== "object" ||
        Array.isArray(field) ||
        !interaction?.locator ||
        !(interaction.member || interaction.target)
      )
        return field;
      const shown = { ...field };
      delete shown.target;
      return shown;
    });
  }
  return { primary, value, arguments: args };
}
