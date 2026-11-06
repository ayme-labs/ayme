// Registering an element filter: the browser runtime checks a filter in its
// own document, where the module runs it, before anything runs it. A filter
// that reads the code around it is refused here, with the identifier it
// reads named.
import {
  filterData,
  ToolInputError,
  type ElementFilter,
  type FilterData,
  type InPageFilter,
} from "../../shared";
import { checkFilter, type FilterCheck } from "../page/filter";

/** The advice every rejected function filter carries. */
const runsOnItsOwn =
  "A filter function runs in the page on its own, so it cannot use variables from the code around it: pass a CSS selector, or move what it needs inside the function.";

/**
 * Checks `filter` for a registration named `name`, as "`ignore`" or "`filter`
 * of the Custom Tool `x`", and returns it as data for the module.
 * Throws a `ToolInputError` when the page cannot run it. A page that forbids
 * `new Function` keeps the function as it was passed, unchecked.
 */
export function registerFilter(
  name: string,
  filter: ElementFilter
): FilterData {
  const data = filterData(filter);
  return checkedFilter(name, filter, data, checkFilter(data));
}

/**
 * Checks `filter` as a registration named `name` where the module runs it,
 * asked through the slot's `check`, for a host in another realm than the page.
 */
export async function registerFilterThrough(
  check: (data: FilterData) => Promise<FilterCheck>,
  name: string,
  filter: ElementFilter
): Promise<FilterData> {
  const data = filterData(filter);
  return checkedFilter(name, filter, data, await check(data));
}

function checkedFilter(
  name: string,
  filter: ElementFilter,
  data: FilterData,
  check: FilterCheck
): FilterData {
  switch (check.kind) {
    case "ok":
      return data;
    case "no-eval":
      return { live: filter as InPageFilter };
    case "bad-selector":
      throw new ToolInputError(
        `The ${name} is not a valid CSS selector: ${check.message}`
      );
    case "not-a-function":
      throw new ToolInputError(
        `The ${name} is not a function the page can run: a native or bound function cannot be sent to the page. Pass a CSS selector, or write the function in your code.`
      );
    case "reads":
      throw new ToolInputError(
        `The ${name} function reads \`${check.identifier}\`, which does not exist in the page. ${runsOnItsOwn}`
      );
  }
}

/**
 * A `ReferenceError` a filter throws while a capture runs, on a branch the
 * registration check did not take, as the same message; any other error as
 * it is.
 */
export function filterFailure(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const identifier = /(?:^|: )(\S+) is not defined$/.exec(message)?.[1];
  if (!identifier) return error;
  return new ToolInputError(
    `A filter function reads \`${identifier}\`, which does not exist in the page. ${runsOnItsOwn}`
  );
}
