import type { ReactNode } from "react";
import {
  CheckIcon,
  CopyIcon,
  CrosshairIcon,
  ListTreeIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import type { StructureNode } from "../../structure";
import type { GroupOutcome, LocatorGroup } from "../domain/locatorGroups";
import { findRefNode, type RefTreeRow } from "../domain/refTree";
import { NodeDetail, refText, RefTreeView } from "./RefTreeView";

const smallButton =
  // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
  "flex h-6.5 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:border-ring aria-expanded:border-ring aria-expanded:bg-primary/10 aria-expanded:text-primary aria-pressed:border-ring aria-pressed:bg-primary/10 aria-pressed:text-primary";

/**
 * `generate_locator`'s form: one card per group with its container and its
 * targets. Targets come from the page, by picking, or from the structure
 * tree, which opens inside the card; each shows the locator the last run gave
 * it, ready to copy.
 */
export function LocatorGroupsView({
  groups,
  outcomes,
  roots,
  rows,
  query,
  setQuery,
  treeOpen,
  pickingInto,
  canPick,
  copied,
  containerField,
  toggleTarget,
  setContainer,
  addGroup,
  removeGroup,
  toggleTree,
  togglePicking,
  copy,
  onPreview,
  onPreviewEnd,
}: {
  groups: readonly LocatorGroup[];
  /** What the last run gave each group, by index. */
  outcomes: readonly (GroupOutcome | undefined)[];
  /** The page's structure, to show what each target is. */
  roots: readonly StructureNode[];
  /** The rows of the open tree. */
  rows: readonly RefTreeRow[];
  query: string;
  setQuery: (query: string) => void;
  /** The group whose tree is open. */
  treeOpen: number | undefined;
  /** The group that picking on the page adds to. */
  pickingInto: number | undefined;
  canPick: boolean;
  /** The locator just copied. */
  copied: string | undefined;
  /** A group's container field. */
  containerField: (index: number, within: string | undefined) => ReactNode;
  toggleTarget: (index: number, ref: string) => void;
  setContainer: (index: number, within: string | undefined) => void;
  addGroup: () => void;
  removeGroup: (index: number) => void;
  toggleTree: (index: number) => void;
  togglePicking: (index: number) => void;
  copy: (locator: string) => void;
  onPreview?: (ref: string) => void;
  onPreviewEnd?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-xs text-muted-foreground">
        One group per page object class. Leave the container empty for the page,
        or set it to a component&apos;s root: its locators are relative to it.
      </p>
      <ul
        aria-label="Locator groups"
        className="m-0 flex list-none flex-col gap-2 p-0"
      >
        {groups.map((group, index) => {
          const name = `group ${index + 1}`;
          const outcome = outcomes[index];
          return (
            <li
              key={index}
              aria-label={`Group ${index + 1}`}
              className="flex flex-col gap-1.5 rounded-lg border p-2"
            >
              <div className="flex items-center gap-1.5">
                <span className="flex-1 text-xs font-semibold">Container</span>
                {group.within && (
                  <button
                    type="button"
                    className="h-5.5 rounded-sm px-1.5 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => setContainer(index, undefined)}
                  >
                    Use the page
                  </button>
                )}
                {groups.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                    onClick={() => removeGroup(index)}
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
              {containerField(index, group.within)}
              <span className="text-xs text-muted-foreground">
                {group.within
                  ? `Locators relative to ${group.within}`
                  : "Locators relative to the page"}
              </span>
              {outcome && "error" in outcome && (
                <p role="alert" className="m-0 text-xs text-destructive">
                  {outcome.error}
                </p>
              )}
              {group.targets.length > 0 && (
                <ul
                  aria-label={`Targets of ${name}`}
                  className="m-0 flex list-none flex-col gap-1 p-0"
                >
                  {group.targets.map((ref) => {
                    const target =
                      outcome && "targets" in outcome
                        ? outcome.targets.get(ref)
                        : undefined;
                    return (
                      <li
                        key={ref}
                        aria-label={ref}
                        className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-1.5 py-1"
                        onMouseEnter={() => onPreview?.(ref)}
                        onMouseLeave={onPreviewEnd}
                      >
                        <span className="flex items-center gap-1.5 font-mono text-xs">
                          <TargetLabel roots={roots} target={ref} />
                          <button
                            type="button"
                            aria-label={`Remove ${ref}`}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                            onClick={() => toggleTarget(index, ref)}
                          >
                            <XIcon className="size-3" aria-hidden />
                          </button>
                        </span>
                        {target && "locator" in target && (
                          <span className="flex min-w-0 items-center gap-1">
                            <code
                              aria-label={`Locator for ${ref}`}
                              className="min-w-0 flex-1 truncate rounded-sm bg-background px-1.5 py-0.5 text-xs text-green-700 dark:text-green-300"
                              title={target.locator}
                            >
                              {target.locator}
                            </code>
                            <button
                              type="button"
                              aria-label={`Copy the locator for ${ref}`}
                              title="Copy"
                              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => copy(target.locator)}
                            >
                              {copied === target.locator ? (
                                <CheckIcon className="size-3" aria-hidden />
                              ) : (
                                <CopyIcon className="size-3" aria-hidden />
                              )}
                            </button>
                          </span>
                        )}
                        {target && "error" in target && (
                          <span className="text-xs text-destructive">
                            {target.error}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {canPick && (
                  <button
                    type="button"
                    aria-pressed={pickingInto === index}
                    title="Click elements on the page to add them; Esc stops"
                    className={smallButton}
                    onClick={() => togglePicking(index)}
                  >
                    <CrosshairIcon className="size-3" aria-hidden />
                    Pick on page
                  </button>
                )}
                <button
                  type="button"
                  aria-expanded={treeOpen === index}
                  className={smallButton}
                  onClick={() => toggleTree(index)}
                >
                  <ListTreeIcon className="size-3" aria-hidden />
                  Add from tree
                </button>
              </div>
              {pickingInto === index && (
                <span className="text-xs text-primary">
                  Click elements on the page to add them. Esc stops.
                </span>
              )}
              {treeOpen === index && (
                <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-1.5">
                  <RefTreeView
                    label={`Add targets to ${name}`}
                    searchLabel={`Search targets for ${name}`}
                    query={query}
                    setQuery={setQuery}
                    rows={rows}
                    selected={(ref) => group.targets.includes(ref)}
                    choose={(ref) => toggleTarget(index, ref)}
                    onPreview={onPreview}
                    onPreviewEnd={onPreviewEnd}
                    className="max-h-80"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={cn(smallButton, "self-start")}
        onClick={addGroup}
      >
        <PlusIcon className="size-3" aria-hidden />
        Add group
      </button>
    </div>
  );
}

/** A target as a row shows it: its ref, role and name, and its member tag. */
function TargetLabel({
  roots,
  target,
}: {
  roots: readonly StructureNode[];
  target: string;
}) {
  const node = findRefNode(roots, target);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className="min-w-0 truncate">
        <span className={refText}>{target}</span>
        {node && <NodeDetail node={node} />}
      </span>
      {node?.tag && (
        <span className="ml-auto flex-none text-primary">{node.tag}</span>
      )}
    </span>
  );
}
