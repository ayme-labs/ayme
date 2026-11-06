// A Node host's door to a real Playwright Page for its Page State Session
// (ADR-0049): the same session code as the browser runtime's, over the
// document's in-page module, with the inputs a capture reads handed as plain
// data, since no function or live value crosses from Node into the page.
import type { Page } from "@playwright/test";
import { inPage, type ElementInputs } from "../../in-page";
import type {
  ActionOutcome,
  Capture,
  NamedFilter,
  Predicate,
} from "../../shared";
import type { PageAction } from "../application/pageStateSession";
import { pageObjectsProbed, type PageStateHost } from "./pageStates";

/**
 * The host of a Node process over `page`: captures and actions go through
 * `inPage(page)`. The Page Object Roots the module places are those of a
 * completed probe run, which the host awaits before each capture it makes,
 * and once more after an action settles, since it cannot be asked from
 * inside the page.
 */
export function playwrightPageHost(page: Page): PageStateHost {
  const module = inPage(page);

  function capture(
    inputs: ElementInputs,
    ask: { accepts?: readonly Predicate[]; filters?: readonly NamedFilter[] }
  ): Promise<Capture> {
    return module.capture({
      elements: inputs,
      ...(ask.accepts ? { accepts: ask.accepts } : {}),
      ...(ask.filters?.length ? { filters: ask.filters } : {}),
    });
  }

  async function begin(
    inputs: () => Promise<ElementInputs>
  ): Promise<PageAction> {
    // Read once, here: a function cannot go into the page, so the captures
    // of this action share these inputs, after the probe this read awaited.
    const resolved = await inputs();
    const action = await module.begin({ elements: resolved });
    return {
      before: action.before,
      async perform<T>(
        perform: () => T | Promise<T>
      ): Promise<ActionOutcome<T>> {
        const outcome = await action.perform(perform);
        // A load answers as it is: the page is another document's by now, or
        // going away, and what the module captured of the old one stands.
        if (outcome.kind === "loading" || outcome.after === undefined)
          return outcome;
        // The module placed the roots of the latest probe run it holds. The
        // action changed the page, so probe again and read it once more.
        if (!pageObjectsProbed(page)) return outcome;
        return { ...outcome, after: await capture(await inputs(), {}) };
      },
    };
  }

  return {
    url: () => page.url(),
    bind: (onVisit) => {
      module.onVisit(onVisit);
      void module.bound().catch(() => {});
    },
    capture,
    begin,
  };
}
