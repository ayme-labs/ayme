import type { KeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, CrosshairIcon, SearchIcon } from "lucide-react";

import { usePortalContainer } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type { RefNode, RefTreeRow } from "../domain/refTree";

/**
 * The control of a ref field. Pressing it opens a searchable tree of the
 * page's structure right away; the crosshair beside it picks a ref by
 * pointing at the page.
 */
export function RefFieldView({
  id,
  "aria-label": label,
  className,
  value,
  open,
  query,
  setQuery,
  picking,
  pickPrompt,
  canPick,
  wrap,
  chooser,
  chosen,
  rows,
  choose,
  toggleTree,
  togglePicking,
  endPicking,
  onTreeKey,
  onSearchKey,
  onPreview,
  onPreviewEnd,
}: {
  id?: string;
  "aria-label": string;
  className?: string;
  value: string;
  /** Whether the tree shows. */
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** Whether a ref is being picked on the page. */
  picking: boolean;
  /** What picking asks the person to click. */
  pickPrompt: string;
  /** Whether the crosshair shows. */
  canPick: boolean;
  wrap: RefObject<HTMLDivElement | null>;
  chooser: RefObject<HTMLButtonElement | null>;
  /** The node of the chosen ref, when the tree has it. */
  chosen: RefNode | undefined;
  rows: readonly RefTreeRow[];
  choose: (ref: string) => void;
  toggleTree: () => void;
  togglePicking: () => void;
  endPicking: () => void;
  onTreeKey: (event: KeyboardEvent) => void;
  onSearchKey: (event: KeyboardEvent) => void;
  onPreview?: (ref: string) => void;
  onPreviewEnd?: () => void;
}) {
  return (
    <div ref={wrap} className="relative flex flex-col gap-1">
      <div className="flex items-stretch gap-1.5">
        <button
          ref={chooser}
          id={id}
          type="button"
          aria-label={label}
          aria-haspopup="tree"
          aria-expanded={open}
          title="Choose from the page structure"
          className={cn(
            className,
            "flex h-auto min-h-[30px] cursor-pointer items-center gap-1 pr-1.5 pl-1 text-left hover:border-ring aria-expanded:border-ring"
          )}
          onClick={toggleTree}
          onMouseEnter={() => value && onPreview?.(value)}
          onMouseLeave={onPreviewEnd}
        >
          {value ? (
            <span className="min-w-0 truncate rounded-[5px] bg-muted px-2 py-0.5 font-mono text-[11.5px] text-foreground">
              <span className={refText}>{value}</span>
              {chosen && <ChosenDetail node={chosen} />}
            </span>
          ) : (
            <span className="px-1 text-muted-foreground">
              Choose an element
            </span>
          )}
          <span className="flex-1" />
          <ChevronDownIcon
            className={cn(
              "size-3.5 flex-none text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {canPick && (
          <button
            type="button"
            aria-label="Pick an element on the page"
            title="Pick an element on the page"
            aria-pressed={picking}
            className="grid w-[34px] flex-none place-items-center rounded-md border border-input bg-background text-muted-foreground hover:border-ring hover:text-foreground aria-pressed:border-ring aria-pressed:bg-primary/10 aria-pressed:text-primary"
            onClick={togglePicking}
          >
            <CrosshairIcon className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {picking && (
        <>
          <span className="text-[11.5px] text-primary">
            {pickPrompt}. Esc cancels.
          </span>
          <PickBanner prompt={pickPrompt} onCancel={endPicking} />
        </>
      )}

      {open && (
        <div
          className="absolute top-full right-10 left-0 z-20 mt-1 flex flex-col gap-1.5 rounded-[10px] border bg-card p-1.5 shadow-lg"
          onKeyDown={onTreeKey}
        >
          <label className="flex h-[30px] items-center gap-1.5 rounded-md border bg-background px-2 text-muted-foreground focus-within:border-ring">
            <SearchIcon className="size-3.5 flex-none" aria-hidden />
            <input
              type="text"
              autoFocus
              spellCheck={false}
              aria-label="Search the page structure"
              placeholder="Search refs, roles and names"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKey}
            />
          </label>
          <div
            role="tree"
            aria-label="Page structure"
            className="flex max-h-[230px] flex-col overflow-auto"
          >
            {rows.map(({ node, depth, text, match, usable }) => (
              <button
                key={node.ref}
                type="button"
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={node.ref === value}
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
        </div>
      )}
    </div>
  );
}

/** Across the top of the page while picking: what to do, and Cancel. */
function PickBanner({
  prompt,
  onCancel,
}: {
  prompt: string;
  onCancel: () => void;
}) {
  const container = usePortalContainer();
  if (!container) return null;
  return createPortal(
    <div className="fixed top-3.5 left-1/2 z-50 inline-flex h-9 -translate-x-1/2 items-center gap-2.5 rounded-full bg-primary pr-1.5 pl-3.5 text-[13px] font-semibold whitespace-nowrap text-primary-foreground shadow-lg">
      <CrosshairIcon className="size-3.5" aria-hidden />
      {prompt}
      <button
        type="button"
        className="h-[26px] rounded-full bg-white/20 px-2.5 text-xs font-semibold hover:bg-white/30"
        onClick={onCancel}
      >
        Cancel picking
      </button>
    </div>,
    container
  );
}

/** A ref as the field shows it: purple, light enough to read on dark. */
const refText = "text-primary dark:text-purple-300";

/**
 * What the field shows after a chosen node's ref, e.g. ` button "Add item"`:
 * its role, then its name, or its text when it has none.
 */
function ChosenDetail({ node }: { node: RefNode }) {
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
