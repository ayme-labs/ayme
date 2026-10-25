// generate_locator: the Browser Tool that turns Structural Refs into Locator
// Recommendations for Page Object Model code. It reads and never acts, so it
// records no Structural Action and leaves the Goal Loop's operations alone.
import {
  parseStructuralRef,
  refFromSelector,
  type PlaywrightLocatorString,
} from "@ayme-dev/core/structural-observation";
import type { Page } from "@playwright/test";
import {
  generateLocator,
  resolveLocatorElements,
} from "@ayme-dev/playwright-lite/internal";
import type { JsonSchema } from "../../shared";
import { asSentence } from "../../shared";
import {
  requireCurrentDocument,
  resolveElementTarget,
  TARGET_SCHEMA,
  type PublishedElementTool,
} from "../application/elementTools";
import { refFailure, selectorFailure } from "../../page-state";
import type { ToolResult } from "../domain/toolTypes";

type Result = ToolResult<"generate_locator">;
type Group = Result["groups"][number];
type Entry = Extract<Group, { locators: unknown }>["locators"][number];

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      description:
        "Groups of targets, one per Page Object class: the page, or a component with its own root.",
      items: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            items: TARGET_SCHEMA,
            description: "The elements to generate locators for.",
          },
          within: {
            ...TARGET_SCHEMA,
            description:
              "The container the locators are relative to, such as a component's root; selector targets are matched inside it. Omitted: relative to the page.",
          },
        },
        required: ["targets"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
};

const TARGET_LABEL = "generate a locator for";
const WITHIN_LABEL = "scope locators to";

/** The definition a target or container resolves under, named by `label`. */
const definition = (label: string) => ({
  label,
  targetField: "target" as const,
});

/**
 * The Locator Recommendation for `element`, relative to `container` when one
 * is given. Playwright's own generator checks it addresses exactly the element,
 * or the interactive ancestor it picked for it; Ayme checks it carries no
 * Structural Ref.
 */
function recommendLocator(
  page: Page,
  element: Element,
  container: Element | undefined
): PlaywrightLocatorString {
  const locator = generateLocator(page, element, {
    ...(container ? { root: container } : {}),
  });
  if (refFromSelector(locator))
    throw new Error(
      `the generated locator ${locator} contains a Structural Ref`
    );
  return locator as PlaywrightLocatorString;
}

/** A failure's reason, as thrown. */
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type Container = { within: string; element: Element; selector: string };

/** Whether `container.locator(selector)` finds `element`, as Page Object code would. */
function holds(
  page: Page,
  container: Container,
  selector: string,
  element: Element
) {
  return resolveLocatorElements(
    page.locator(container.selector).locator(selector)
  ).includes(element);
}

async function entryFor(
  page: Page,
  target: string,
  container: Container | undefined,
  currentDocument: Document
): Promise<Entry> {
  // A selector is matched inside the container; a Structural Ref names its
  // element wherever it is, so it is checked to be inside.
  const isRef = parseStructuralRef(target) !== undefined;
  const fail = (why: string) => ({
    target,
    error: (isRef ? refFailure : selectorFailure)(TARGET_LABEL, target, why),
  });
  let element: Element, selector: string;
  try {
    ({ element, selector } = await resolveElementTarget(
      page,
      definition(TARGET_LABEL),
      target,
      currentDocument,
      isRef ? undefined : container?.selector
    ));
  } catch (error) {
    return { target, error: asSentence(reason(error)) };
  }
  if (container && isRef && !holds(page, container, selector, element))
    return fail(`it is not inside the container "${container.within}"`);
  try {
    return {
      target,
      locator: recommendLocator(page, element, container?.element),
    };
  } catch (error) {
    return fail(reason(error));
  }
}

async function groupFor(
  page: Page,
  group: { targets: string[]; within?: string },
  currentDocument: Document
): Promise<Group> {
  let container: Container | undefined;
  if (group.within !== undefined)
    try {
      const { element, selector } = await resolveElementTarget(
        page,
        definition(WITHIN_LABEL),
        group.within,
        currentDocument
      );
      container = { within: group.within, element, selector };
    } catch (error) {
      return { within: group.within, error: asSentence(reason(error)) };
    }
  const locators: Entry[] = [];
  for (const target of group.targets)
    locators.push(await entryFor(page, target, container, currentDocument));
  return {
    ...(group.within !== undefined ? { within: group.within } : {}),
    locators,
  };
}

/** Package-internal: the generate_locator Browser Tool, published only. */
export const generateLocatorTool: PublishedElementTool = {
  name: "generate_locator",
  // Wording for the agent to read; no test should pin the prose.
  // Stryker disable StringLiteral: tool description wording
  description: [
    "Generate Playwright locators for elements, to write into Page Object Model code; does not act on the page.",
    "Structural Refs are capture-scoped: use them in tool calls, never in code. The locators are what belongs in a page object.",
    "Group targets by the container they belong to: a group's locators are relative to its `within` container, ready for a component's `root`, or to the page without one. Selector targets are matched inside the container.",
    "Each locator is checked to match exactly its element. A target that cannot be resolved fails on its own entry, and a container on its own group.",
  ].join(" "),
  // Stryker restore StringLiteral
  inputSchema,
  execute: async (input, { page }) => {
    const { groups } = input as {
      groups: { targets: string[]; within?: string }[];
    };
    const currentDocument = requireCurrentDocument();
    const result: Result = { groups: [] };
    for (const group of groups)
      result.groups.push(await groupFor(page, group, currentDocument));
    return result;
  },
};
