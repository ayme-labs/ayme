import { registerFilterThrough } from "../in-page";
import type { FilterCheck } from "../in-page";
import type { ElementFilter, FilterData, NamedFilter } from "../shared";

/** What a session's options hand a capture to leave out and to keep, as data. */
export type CheckedFilters = {
  ignore: FilterData | undefined;
  customFilters: NamedFilter[];
};

/**
 * The options' filters, checked as the page runs them, through the slot's
 * check: `ignore`, and each Custom Tool's `filter` under the tool's name.
 * Rejects with a `ToolInputError` for a filter the page cannot run.
 */
export async function checkedFilters(
  check: (data: FilterData) => Promise<FilterCheck>,
  options: {
    ignore?: ElementFilter;
    customTools?: readonly { name: string; filter?: ElementFilter }[];
  }
): Promise<CheckedFilters> {
  const ignore =
    options.ignore === undefined
      ? undefined
      : await registerFilterThrough(check, "`ignore`", options.ignore);
  const customFilters: NamedFilter[] = [];
  for (const tool of options.customTools ?? [])
    if (tool.filter !== undefined)
      customFilters.push({
        name: tool.name,
        filter: await registerFilterThrough(
          check,
          `\`filter\` of the Custom Tool \`${tool.name}\``,
          tool.filter
        ),
      });
  return { ignore, customFilters };
}
