import type { PageTool } from "../../contract";

/**
 * Whether the server lists a tool of the paired page. Without
 * `browserTools` it lists the page's Page Object Tools, `page_objects` and
 * Peek Tools, and none of Ayme's own browser driving: no Browser Tool, no
 * `snapshot` or `goal`, and no Custom Tool, which names its element by a
 * Structural Ref only `snapshot` gives. With `browserTools` it lists every
 * tool. A tool whose page did not say its group is listed.
 */
export function listsPageTool(
  { name, group }: PageTool,
  { browserTools }: { browserTools: boolean }
): boolean {
  return (
    browserTools ||
    group === undefined ||
    group === "pageObject" ||
    group === "peek" ||
    name === "page_objects"
  );
}
