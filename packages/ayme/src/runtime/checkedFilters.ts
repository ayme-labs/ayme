import type { Page } from "@playwright/test";
import { registerFilterThrough } from "../in-page";
import type { FilterCheck } from "../in-page";
import type { ElementFilter, NamedFilter, SessionFilter } from "../shared";

/** What a session's options hand its captures to leave out and to keep. */
export type CheckedFilters = {
  ignore: SessionFilter | undefined;
  customFilters: NamedFilter<SessionFilter>[];
};

/**
 * The options' filters for a session on `page`, as a Node host registers
 * them: `ignore`, and each Custom Tool's `filter` under the tool's name, a
 * selector checked through the slot's check, a function called once with
 * `page`. Rejects with a `ToolInputError` for a selector the page cannot
 * parse, and for a function that throws or returns no Locator.
 */
export async function checkedFilters(
  check: (filter: { selector: string }) => Promise<FilterCheck>,
  page: Page,
  options: {
    ignore?: ElementFilter;
    customTools?: readonly { name: string; filter?: ElementFilter }[];
  }
): Promise<CheckedFilters> {
  const ignore =
    options.ignore === undefined
      ? undefined
      : await registerFilterThrough(check, "`ignore`", options.ignore, page);
  const customFilters: NamedFilter<SessionFilter>[] = [];
  for (const tool of options.customTools ?? [])
    if (tool.filter !== undefined)
      customFilters.push({
        name: tool.name,
        filter: await registerFilterThrough(
          check,
          `\`filter\` of the Custom Tool \`${tool.name}\``,
          tool.filter,
          page
        ),
      });
  return { ignore, customFilters };
}
