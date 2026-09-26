import { listRegisteredPomTargets } from "@ayme-dev/webmcp/internal";

import {
  copyTraceEntryLocator,
  traceEntryLocator,
  type TraceEntry,
} from "../trace";

/** A step of a run: a locator operation from the Inspector's own trace. */
export type RunStep = TraceEntry & {
  /**
   * The Page Object member it acted on, e.g. "ListPage.addItemButton",
   * when its element was still on the page as the run ended.
   */
  member?: string;
};

/** The elements a step's locator matches on the page now. */
async function elementsOf(step: TraceEntry): Promise<Element[]> {
  const locator = traceEntryLocator(step);
  if (!locator) return [];
  try {
    // A page function's result is serialized, so it names each element by
    // its place in the document. The Inspector's own elements, inside its
    // shadow root, have none.
    const places = await locator.evaluateAll((elements) => {
      const all = [...document.getElementsByTagName("*")];
      return elements.map((element) => all.indexOf(element));
    });
    const all = document.getElementsByTagName("*");
    return places.flatMap((place) => {
      const element = place === -1 ? undefined : all[place];
      return element ? [element] : [];
    });
  } catch {
    return [];
  }
}

/** Names the member each step acted on, where its element is still there. */
export async function describeSteps(
  steps: readonly TraceEntry[]
): Promise<RunStep[]> {
  if (!steps.length) return [];
  let targets: Awaited<ReturnType<typeof listRegisteredPomTargets>> = [];
  try {
    targets = await listRegisteredPomTargets();
  } catch {
    // Without the registry's targets, steps keep their locators.
  }
  return await Promise.all(
    steps.map(async (step) => {
      const elements = await elementsOf(step);
      // The first path the registry lists for an element is its own member.
      const target = targets.find(({ element }) => elements.includes(element));
      const described: RunStep = target
        ? { ...step, member: target.path.replace(/\.root$/, "") }
        : { ...step };
      copyTraceEntryLocator(described, step);
      return described;
    })
  );
}

let highlighted: Element[] = [];
let request = 0;

/**
 * Highlights the element a run's step acted on, while it's still on the
 * page. Resolves to whether the element is there.
 */
export async function previewStep(step: TraceEntry): Promise<boolean> {
  clearStepPreview();
  const current = ++request;
  const elements = await elementsOf(step);
  if (current !== request) return elements.length > 0;
  // Leave a highlight the Inspector already shows, such as a pinned one.
  highlighted = elements.filter(
    (element) => !element.hasAttribute("data-ayme-highlight")
  );
  for (const element of highlighted)
    element.setAttribute("data-ayme-highlight", "");
  return elements.length > 0;
}

export function clearStepPreview() {
  request += 1;
  for (const element of highlighted)
    element.removeAttribute("data-ayme-highlight");
  highlighted = [];
}
