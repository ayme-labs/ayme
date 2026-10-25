// The Browser Tools as published. The list lives here, not beside the
// Browser Tools in application, because it includes generate_locator and
// press_key, which use Playwright Lite, and the navigation tools, built on the
// router store.
import { ACTION_RESULT_NOTE } from "../../page-state";
import {
  fillFormTool,
  SINGLE_ELEMENT_TOOLS,
} from "../application/browserTools";
import type { PublishedElementTool } from "../application/elementTools";
import { screenshotTool } from "../application/screenshotTool";
import { generateLocatorTool } from "./generateLocator";
import { pressKeyTool } from "./pressKey";
import { NAVIGATION_TOOLS } from "./routerStore";

/**
 * A Browser Tool that acts on the page, as published: its description ends
 * with how the action result reports what changed. Only Ayme's own Browser
 * Tools carry the sentence; a Page Object Tool or Custom Tool is published
 * with the description its author wrote, and the Goal Loop offers its model
 * every tool's own description.
 */
function withActionResultNote(
  tool: PublishedElementTool
): PublishedElementTool {
  return { ...tool, description: `${tool.description} ${ACTION_RESULT_NOTE}` };
}

/** Computed once, so a Browser Tool resolves to the same object across publications. */
const PUBLISHED_BROWSER_TOOLS: readonly PublishedElementTool[] = [
  ...SINGLE_ELEMENT_TOOLS.map(({ tool }) => withActionResultNote(tool)),
  withActionResultNote(fillFormTool),
  withActionResultNote(pressKeyTool),
  generateLocatorTool,
  screenshotTool,
  ...NAVIGATION_TOOLS.map(withActionResultNote),
];

/** Package-internal: every Browser Tool as published, in publication order. */
export function listPublishedBrowserTools(): readonly PublishedElementTool[] {
  return PUBLISHED_BROWSER_TOOLS;
}
