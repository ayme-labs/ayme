import type { PublishedElementTool } from "../application/elementTools";
import {
  navigateBackTool,
  navigateForwardTool,
  reloadTool,
} from "../application/historyTools";
import { navigateTool } from "../application/navigateTool";

/**
 * Package-internal: the Browser Tools that move the page to another URL or
 * history entry, in publication order. They take no element; each is
 * published and the Goal Loop may choose it. `navigate` hands its URL to the
 * router function its Run carries, if any. Computed once, so each resolves to
 * the same object across publications.
 */
export const NAVIGATION_TOOLS: readonly PublishedElementTool[] = [
  navigateTool,
  navigateBackTool,
  navigateForwardTool,
  reloadTool,
];
