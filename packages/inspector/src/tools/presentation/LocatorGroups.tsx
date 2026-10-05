import type { Run } from "../../runs";
import type { LocatorGroup } from "../domain/locatorGroups";
import type { RefSource } from "../domain/refTree";
import { LocatorGroupsView } from "../view/LocatorGroupsView";
import { RefField } from "./RefField";
import { useLocatorGroups } from "./useLocatorGroups";

/**
 * `generate_locator`'s form: one card per group, a page object class, with
 * its container and its targets, each with the locator the last run gave it.
 */
export function LocatorGroups({
  source,
  lastRun,
  onChange,
}: {
  /** The page's structure, picking on the page, and its hover preview. */
  source: RefSource;
  /** The tool's last run: its locators show beside the targets. */
  lastRun: Run | undefined;
  /** Gets the groups to run with whenever they change. */
  onChange: (groups: LocatorGroup[]) => void;
}) {
  const form = useLocatorGroups({ source, lastRun, onChange });
  return (
    <LocatorGroupsView
      {...form}
      roots={source.roots}
      containerField={(index, within) => (
        <RefField
          aria-label={`Container of group ${index + 1}`}
          className="flex-1"
          value={within ?? ""}
          onChange={(ref) => form.setContainer(index, ref)}
          source={{ ...source, pickPrompt: "Click the container" }}
        />
      )}
    />
  );
}
