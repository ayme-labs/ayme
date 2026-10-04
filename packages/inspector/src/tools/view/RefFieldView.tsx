import type { KeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, CrosshairIcon } from "lucide-react";

import { usePortalContainer } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type { RefNode, RefTreeRow } from "../domain/refTree";
import { refText, RefTreeView } from "./RefTreeView";

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
            "flex h-auto min-h-7.5 cursor-pointer items-center gap-1 pr-1.5 pl-1 text-left hover:border-ring aria-expanded:border-ring"
          )}
          onClick={toggleTree}
          onMouseEnter={() => value && onPreview?.(value)}
          onMouseLeave={onPreviewEnd}
        >
          {value ? (
            <span className="min-w-0 truncate rounded-sm bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
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
            className="grid w-8.5 flex-none place-items-center rounded-md border border-input bg-background text-muted-foreground hover:border-ring hover:text-foreground aria-pressed:border-ring aria-pressed:bg-primary/10 aria-pressed:text-primary"
            onClick={togglePicking}
          >
            <CrosshairIcon className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {picking && (
        <>
          <span className="text-xs text-primary">
            {pickPrompt}. Esc cancels.
          </span>
          <PickBanner prompt={pickPrompt} onCancel={endPicking} />
        </>
      )}

      {open && (
        <div
          className="absolute top-full right-10 left-0 z-20 mt-1 flex flex-col gap-1.5 rounded-lg border bg-card p-1.5 shadow-lg"
          onKeyDown={onTreeKey}
        >
          <RefTreeView
            query={query}
            setQuery={setQuery}
            onSearchKey={onSearchKey}
            rows={rows}
            selected={(ref) => ref === value}
            choose={choose}
            onPreview={onPreview}
            onPreviewEnd={onPreviewEnd}
          />
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
    <div className="fixed top-3.5 left-1/2 z-50 inline-flex h-9 -translate-x-1/2 items-center gap-2.5 rounded-full bg-primary pr-1.5 pl-3.5 text-sm font-semibold whitespace-nowrap text-primary-foreground shadow-lg">
      <CrosshairIcon className="size-3.5" aria-hidden />
      {prompt}
      <button
        type="button"
        className="h-6.5 rounded-full bg-white/20 px-2.5 text-xs font-semibold hover:bg-white/30"
        onClick={onCancel}
      >
        Cancel picking
      </button>
    </div>,
    container
  );
}

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
