import type { KeyboardEvent } from "react";
import { SearchIcon } from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import type { RefNode, RefTreeRow } from "../domain/refTree";

/** A ref as the Inspector shows it: purple, light enough to read on dark. */
export const refText = "text-primary dark:text-purple-300";

/**
 * A searchable tree of the page's structure: each node with a ref, by its
 * ref, role and name. Choosing a node is the caller's to decide.
 */
export function RefTreeView({
  label = "Page structure",
  searchLabel = "Search the page structure",
  query,
  setQuery,
  onSearchKey,
  rows,
  selected,
  choose,
  onPreview,
  onPreviewEnd,
  className,
}: {
  /** The tree's accessible name. */
  label?: string;
  /** The search field's accessible name. */
  searchLabel?: string;
  query: string;
  setQuery: (query: string) => void;
  onSearchKey?: (event: KeyboardEvent) => void;
  rows: readonly RefTreeRow[];
  /** Whether a node shows as chosen. */
  selected: (ref: string) => boolean;
  choose: (ref: string) => void;
  onPreview?: (ref: string) => void;
  onPreviewEnd?: () => void;
  /** The tree's own classes, e.g. its height. */
  className?: string;
}) {
  return (
    <>
      <label className="flex h-7.5 items-center gap-1.5 rounded-md border bg-background px-2 text-muted-foreground focus-within:border-ring">
        <SearchIcon className="size-3.5 flex-none" aria-hidden />
        <input
          type="text"
          autoFocus
          spellCheck={false}
          aria-label={searchLabel}
          placeholder="Search refs, roles and names"
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKey}
        />
      </label>
      <div
        role="tree"
        aria-label={label}
        className={cn("flex max-h-57.5 flex-col overflow-auto", className)}
      >
        {rows.map(({ node, depth, text, match, usable }) => (
          <button
            key={node.ref}
            type="button"
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={selected(node.ref)}
            disabled={!usable}
            className={cn(
              "flex w-full flex-none items-baseline gap-1.5 rounded py-1 pr-1.5 text-left font-mono text-xs whitespace-nowrap hover:bg-muted aria-selected:bg-primary/10",
              !match && "opacity-55",
              "disabled:cursor-default disabled:bg-transparent disabled:opacity-45"
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => choose(node.ref)}
            onMouseEnter={() => onPreview?.(node.ref)}
            onMouseLeave={onPreviewEnd}
          >
            <span className={refText}>{node.ref}</span>
            <span>{node.role}</span>
            {(node.name || text) && (
              <span
                className={cn(
                  "min-w-0 truncate",
                  node.name
                    ? "text-green-700 dark:text-green-300"
                    : "text-muted-foreground"
                )}
              >
                {node.name ? JSON.stringify(node.name) : text}
              </span>
            )}
          </button>
        ))}
        {rows.length === 0 && (
          <p className="m-0 p-2 text-center text-xs text-muted-foreground">
            No element matches.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * What shows after a node's ref, e.g. ` button "Add item"`: its role, then
 * its name, or its text when it has none.
 */
export function NodeDetail({ node }: { node: RefNode }) {
  const text = node.children
    .filter((child) => child.role === "text" && child.ref === undefined)
    .map((child) => child.name)
    .join(" ");
  return (
    <>
      {` ${node.role}`}
      {node.name ? (
        <span className="text-green-700 dark:text-green-300">
          {` ${JSON.stringify(node.name)}`}
        </span>
      ) : (
        text && <span className="text-muted-foreground">{` ${text}`}</span>
      )}
    </>
  );
}
