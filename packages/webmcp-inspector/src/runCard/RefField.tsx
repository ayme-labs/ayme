import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, CrosshairIcon, SearchIcon } from "lucide-react";

import { usePortalContainer } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type { StructureNode } from "../adapter/structure";
import { refTreeRows, type CanUseNode, type RefNode } from "./refTree";

/** Where a ref field chooses its ref from. */
export type RefSource = {
  /** The page's structure tree. */
  roots: readonly StructureNode[];
  /** Whether the tool can use a node. The ones it can't are disabled. Every node, by default. */
  canUse?: CanUseNode;
  /**
   * Picks a ref by pointing at the page: `accept` tells which refs can be
   * picked, and `onEnd` gets the ref clicked, or none when Esc cancels.
   * Returns a function that stops picking. Without it, there's no crosshair.
   */
  onPick?: (handlers: {
    accept: (ref: string) => boolean;
    onEnd: (ref: string | undefined) => void;
  }) => () => void;
  /** Highlights a ref's element on the page while it's hovered. */
  onPreview?: (ref: string) => void;
  onPreviewEnd?: () => void;
};

/**
 * The control of a ref field. Pressing it opens a searchable tree of the
 * page's structure right away; the crosshair beside it picks a ref by
 * pointing at the page.
 */
export function RefField({
  id,
  "aria-label": label,
  className,
  value,
  onChange,
  source,
}: {
  id?: string;
  "aria-label": string;
  className?: string;
  value: string;
  onChange: (ref: string | undefined) => void;
  source: RefSource;
}) {
  const { roots, canUse, onPick, onPreview, onPreviewEnd } = source;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLButtonElement>(null);
  const stopPicking = useRef<() => void>(undefined);
  // Picking outlives renders: it judges refs by the tree as it is now.
  const latest = useRef({ roots, canUse });
  useEffect(() => {
    latest.current = { roots, canUse };
  });

  const chosen = value ? findNode(roots, value) : undefined;
  const rows = open ? refTreeRows(roots, { query, canUse }) : [];

  const close = () => {
    setOpen(false);
    setQuery("");
    onPreviewEnd?.();
  };
  const choose = (ref: string) => {
    onChange(ref);
    close();
    chooser.current?.focus();
  };
  const endPicking = () => {
    stopPicking.current?.();
    stopPicking.current = undefined;
    setPicking(false);
  };

  // The tree closes on a press outside the field.
  useEffect(() => {
    if (!open) return;
    const onPress = (event: PointerEvent) => {
      if (wrap.current && !event.composedPath().includes(wrap.current)) {
        setOpen(false);
        setQuery("");
        onPreviewEnd?.();
      }
    };
    window.addEventListener("pointerdown", onPress, true);
    return () => window.removeEventListener("pointerdown", onPress, true);
  }, [open, onPreviewEnd]);
  useEffect(() => () => stopPicking.current?.(), []);

  const togglePicking = () => {
    if (picking) return endPicking();
    if (!onPick) return;
    close();
    setPicking(true);
    stopPicking.current = onPick({
      accept: (ref) => {
        const { roots, canUse } = latest.current;
        const node = findNode(roots, ref);
        // A node the tree doesn't show yet is left for the tool to judge.
        return !node || !canUse || canUse(node);
      },
      onEnd: (ref) => {
        stopPicking.current = undefined;
        setPicking(false);
        if (ref !== undefined) onChange(ref);
      },
    });
  };

  const onTreeKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
    chooser.current?.focus();
  };
  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    // Enter chooses the first match the tool can use; it never submits.
    event.preventDefault();
    const first = rows.find((row) => row.match && row.usable);
    if (first) choose(first.node.ref);
  };

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
          onClick={() => {
            if (open) return close();
            endPicking();
            setOpen(true);
          }}
          onMouseEnter={() => value && onPreview?.(value)}
          onMouseLeave={onPreviewEnd}
        >
          {value ? (
            <span className="min-w-0 truncate rounded-[5px] bg-muted px-2 py-0.5 font-mono text-[11.5px] text-primary">
              {chosen ? nodeLabel(chosen) : value}
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
        {onPick && (
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
            Click an element on the page. Esc cancels.
          </span>
          <PickBanner onCancel={endPicking} />
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
                <span className="text-primary">{node.ref}</span>
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
function PickBanner({ onCancel }: { onCancel: () => void }) {
  const container = usePortalContainer();
  if (!container) return null;
  return createPortal(
    <div className="fixed top-3.5 left-1/2 z-50 inline-flex h-9 -translate-x-1/2 items-center gap-2.5 rounded-full bg-primary pr-1.5 pl-3.5 text-[13px] font-semibold whitespace-nowrap text-primary-foreground shadow-lg">
      <CrosshairIcon className="size-3.5" aria-hidden />
      Click an element on the page
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

/** A node as the field shows it chosen, e.g. e12 button "Add item". */
function nodeLabel(node: RefNode) {
  if (node.name) return `${node.ref} ${node.role} ${JSON.stringify(node.name)}`;
  const text = node.children
    .filter((child) => child.role === "text" && child.ref === undefined)
    .map((child) => child.name)
    .join(" ");
  return `${node.ref} ${node.role}${text ? ` ${text}` : ""}`;
}

function findNode(
  nodes: readonly StructureNode[],
  ref: string
): RefNode | undefined {
  for (const node of nodes) {
    if (node.ref === ref) return node as RefNode;
    const found = findNode(node.children, ref);
    if (found) return found;
  }
}
