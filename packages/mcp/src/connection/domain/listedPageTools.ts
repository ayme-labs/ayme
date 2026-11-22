import type { PageTool } from "../../contract";

/**
 * Whether the server lists a tool of the paired page: its Page Object
 * Tools, `page_objects` and Peek Tools, and none of Ayme's own browser
 * driving. A coding agent drives the browser with its own browser
 * automation, so no Browser Tool, no `snapshot` or `goal`, and no Custom
 * Tool, which names its element by a Structural Ref only `snapshot` gives.
 * A tool whose page did not say its group is listed.
 */
export function listsPageTool({ name, group }: PageTool): boolean {
  return (
    group === undefined ||
    group === "pageObject" ||
    group === "peek" ||
    name === "page_objects"
  );
}
