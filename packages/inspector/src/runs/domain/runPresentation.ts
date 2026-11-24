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
  const primary = primaryInput(run);
  const args = { ...run.arguments };
  const selected = selectedOptions(run, primary);
  const value = selected ?? primary?.value;
  if (selected) delete args.values;
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
  if (run.item?.id === args.id) delete args.id;
  if (run.toolName === "fill_form" && Array.isArray(args.fields)) {
    // One input per field, in order; a failed tail keeps its unresolved targets.
    args.fields = args.fields.map((field, index) =>
      shownField(field, run.interactions[index])
    );
  }
  return { primary, value, arguments: args };
}

function selectedOptions(run: ChildRun, primary: RunInteraction | undefined) {
  const values = run.arguments.values;
  if (
    primary &&
    run.toolName === "select_option" &&
    Array.isArray(values) &&
    values.every((option) => typeof option === "string")
  )
    return values;
  return undefined;
}

function primaryInput(run: ChildRun): RunInteraction | undefined {
  if (!elementTools.has(run.toolName) || run.interactions.length > 1)
    return undefined;
  if (run.interactions[0]) return run.interactions[0];
  if (typeof run.arguments.target === "string")
    return { operation: run.toolName, locator: run.arguments.target };
  if (run.toolName === "press_key" && typeof run.arguments.key === "string")
    return { operation: run.toolName, value: run.arguments.key };
  return undefined;
}

function shownField(
  field: ToolArguments[string],
  interaction: RunInteraction | undefined
) {
  if (!field || typeof field !== "object" || Array.isArray(field)) return field;
  if (!interaction?.locator || !(interaction.member || interaction.target))
    return field;
  const shown: ToolArguments = { ...field };
  delete shown.target;
  return shown;
}
