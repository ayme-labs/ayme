// generate_locator: the Browser Tool that turns Structural Refs into Locator
// Recommendations for Page Object Model code. It reads and never acts, so it
// records no Structural Action and leaves the Goal Loop's operations alone.
import {
  refFromSelector,
  type PlaywrightLocatorString,
} from "@ayme-dev/core/structural-observation";
import { generateLocator } from "@ayme-dev/playwright-lite/internal";
import type { JsonSchema } from "../shared";
import { asSentence } from "../shared";
import {
  requireCurrentDocument,
  resolveElementTarget,
  TARGET_SCHEMA,
  type PublishedElementTool,
} from "./elementTools";
import { requireAymeRuntimePage } from "../page-objects";
import type { ToolResult } from "./toolTypes";

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
              "The container the locators are relative to, such as a component's root. Omitted: relative to the page.",
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

/** Resolve a target or container, or throw the error its entry reports. */
async function resolve(
  label: string,
  requested: string,
  currentDocument: Document
): Promise<Element> {
  const { element } = await resolveElementTarget(
    { label, targetField: "target" },
    requested,
    currentDocument
  );
  return element;
}

/** Whether `element` lies inside `container`, across shadow roots. */
function isInside(element: Element, container: Element): boolean {
  for (let node = element.parentNode; node;) {
    if (node === container) return true;
    node = node instanceof ShadowRoot ? node.host : node.parentNode;
  }
  return false;
}

/**
 * The Locator Recommendation for `element`, relative to `container` when one
 * is given. Playwright's own generator checks it addresses exactly the element,
 * or the interactive ancestor it picked for it; Ayme checks it carries no
 * Structural Ref.
 */
function recommendLocator(
  element: Element,
  container: Element | undefined
): PlaywrightLocatorString {
  const locator = generateLocator(requireAymeRuntimePage(), element, {
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

type Container = { within: string; element: Element };

async function entryFor(
  target: string,
  container: Container | undefined,
  currentDocument: Document
): Promise<Entry> {
  const fail = (why: string) => ({
    target,
    error: asSentence(`Cannot ${TARGET_LABEL} "${target}": ${why}`),
  });
  let element: Element;
  try {
    element = await resolve(TARGET_LABEL, target, currentDocument);
  } catch (error) {
    return { target, error: asSentence(reason(error)) };
  }
  if (container && !isInside(element, container.element))
    return fail(`it is not inside the container "${container.within}"`);
  try {
    return { target, locator: recommendLocator(element, container?.element) };
  } catch (error) {
    return fail(reason(error));
  }
}

async function groupFor(
  group: { targets: string[]; within?: string },
  currentDocument: Document
): Promise<Group> {
  let container: Container | undefined;
  if (group.within !== undefined)
    try {
      container = {
        within: group.within,
        element: await resolve(WITHIN_LABEL, group.within, currentDocument),
      };
    } catch (error) {
      return { within: group.within, error: asSentence(reason(error)) };
    }
  const locators: Entry[] = [];
  for (const target of group.targets)
    locators.push(await entryFor(target, container, currentDocument));
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
    "Group targets by the container they belong to: a group's locators are relative to its `within` container, ready for a component's `root`, or to the page without one.",
    "Each locator is checked to match exactly its element. A target that cannot be resolved fails on its own entry, and a container on its own group.",
  ].join(" "),
  // Stryker restore StringLiteral
  inputSchema,
  execute: async (input) => {
    const { groups } = input as {
      groups: { targets: string[]; within?: string }[];
    };
    const currentDocument = requireCurrentDocument();
    const result: Result = { groups: [] };
    for (const group of groups)
      result.groups.push(await groupFor(group, currentDocument));
    return result;
  },
};
