// Registering an element filter: a host checks a filter where the module runs
// it before anything runs it: the browser runtime, whose realm is the page,
// runs the check itself; a Node host asks through the slot's `check`. A filter that reads
// the code around it is refused here, with the identifier it reads named.
import {
  checkFilter,
  filterData,
  ToolInputError,
  type ElementFilter,
  type FilterCheck,
  type FilterData,
  type InPageFilter,
} from "../../shared";

/** The advice every rejected function filter carries. */
const runsOnItsOwn =
  "A filter function runs in the page on its own, so it cannot use variables from the code around it: pass a CSS selector, or move what it needs inside the function.";

/**
 * Checks `filter` for a registration named `name`, in the realm of the page
 * whose root element is `root`, and returns it as data for the module. Throws a
 * `ToolInputError` when the page cannot run it.
 */
export function registerFilter(
  name: string,
  filter: ElementFilter,
  root: Element
): FilterData {
  const data = filterData(filter);
  return checkedFilter(name, filter, data, checkFilter(data, root), true);
}

/**
 * Checks `filter` as a registration named `name`, as "`ignore`" or "`filter`
 * of the Custom Tool `x`", where the module runs it, asked through the slot's
 * `check`, and returns it as data for the module. Throws a `ToolInputError`
 * when the page cannot run it, a function included when the page forbids
 * `new Function`: the host's function cannot cross to the page.
 */
export async function registerFilterThrough(
  check: (data: FilterData) => Promise<FilterCheck>,
  name: string,
  filter: ElementFilter
): Promise<FilterData> {
  const data = filterData(filter);
  return checkedFilter(name, filter, data, await check(data), false);
}

function checkedFilter(
  name: string,
  filter: ElementFilter,
  data: FilterData,
  check: FilterCheck,
  sameRealm: boolean
): FilterData {
  switch (check.kind) {
    case "ok":
      return data;
    case "no-eval":
      // The function itself reaches the module only in the page's own realm;
      // a Node host's function cannot cross Playwright's argument boundary.
      if (sameRealm) return { live: filter as InPageFilter };
      throw new ToolInputError(
        `The ${name} function cannot run in this page: the page forbids evaluating code, and a function from another process cannot be sent to it. Pass a CSS selector instead.`
      );
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
 * What a capture throws when a filter reads the code around it on a branch
 * the registration's one check did not take (the check runs the function once,
 * on the document's root, so a read behind a condition is reported the first
 * time that branch runs), as a `ToolInputError` naming the registration and
 * the identifier; any other error as it is. The page names them in the
 * message it throws (`guarded`, in the page part).
 */
export function filterFailure(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const found = /ayme-filter-reads:(\S+?):([^\n]*)/.exec(message);
  if (!found) return error;
  return new ToolInputError(
    `The ${found[2]} function reads \`${found[1]}\`, which does not exist in the page. It ran on an element the registration check did not reach, which runs the function once. ${runsOnItsOwn}`
  );
}
