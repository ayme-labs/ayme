import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  BoxIcon,
  BracesIcon,
  ChevronRightIcon,
  FileIcon,
  GlobeIcon,
  LayersIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import type { PageObjectModel, PageObjectNode } from "../../adapter/pageModel";
import { usePointerDrag } from "../../shell/pointerDrag";
import type { Selection } from "../../frame/selection";
import type { Highlighting } from "./highlight";

/** The share of the height the first pane starts with, and its bounds. */
const defaultSplit = 0.58;
const minSplit = 0.15;
const maxSplit = 0.85;
const splitStep = 0.05;

const kindIcon: Record<PageObjectNode["kind"], LucideIcon> = {
  page: FileIcon,
  component: BoxIcon,
  collection: LayersIcon,
  item: BoxIcon,
};

/**
 * The Model lens's tree: the Page Objects on this page, and the Page Object
 * Models the page knows. Each pane collapses to its header; when both are
 * open, a divider between them shares the height out.
 */
export function ModelTree({
  host,
  objects,
  models,
  liveCount,
  selection,
  highlight,
  onPickPage,
  onPickObject,
  onPickModel,
}: {
  /** The page's host, e.g. localhost:5173. */
  host: string;
  objects: readonly PageObjectNode[];
  models: readonly PageObjectModel[];
  /** How many Page Objects are on the page now. */
  liveCount: number;
  selection: Selection;
  highlight: Highlighting;
  onPickPage: () => void;
  onPickObject: (node: PageObjectNode) => void;
  onPickModel: (className: string) => void;
}) {
  const [objectsOpen, setObjectsOpen] = useState(true);
  const [modelsOpen, setModelsOpen] = useState(true);
  const [split, setSplit] = useState(defaultSplit);
  const bothOpen = objectsOpen && modelsOpen;

  const rows = [...treeRows(objects, 1)];
  const selectedPath = selection.kind === "object" ? selection.path : undefined;
  const selectedModel =
    selection.kind === "model" ? selection.className : undefined;

  return (
    <div className="-m-1.5 flex h-[calc(100%+12px)] min-h-0 flex-col">
      <Pane
        title={`On this page · ${liveCount}`}
        open={objectsOpen}
        onToggle={() => setObjectsOpen((open) => !open)}
        grow={bothOpen ? split : 1}
      >
        <div role="tree" aria-label="Page objects">
          <TreeRow
            label="Page /"
            name="/"
            depth={0}
            icon={GlobeIcon}
            type={host}
            selected={selection.kind === "page"}
            onClick={onPickPage}
          />
          {rows.map(({ node, depth }) => (
            <TreeRow
              key={node.path}
              label={node.path}
              name={node.name}
              depth={depth}
              icon={kindIcon[node.kind]}
              type={
                node.kind === "collection"
                  ? `${node.className}[${node.itemCount ?? 0}]`
                  : node.kind === "page"
                    ? "page"
                    : node.className
              }
              live={node.live}
              selected={node.path === selectedPath}
              onClick={() => onPickObject(node)}
              {...highlight.hover(node.live ? node.highlightPath : undefined)}
            />
          ))}
        </div>
      </Pane>
      {bothOpen && <Divider split={split} onSplitChange={setSplit} />}
      <Pane
        title={`Page object models · ${models.length}`}
        open={modelsOpen}
        onToggle={() => setModelsOpen((open) => !open)}
        grow={bothOpen ? 1 - split : 1}
      >
        <ul aria-label="Page object models">
          {models.map((model) => {
            const live = model.instancePaths.length > 0;
            return (
              <li key={model.className}>
                <button
                  type="button"
                  aria-label={model.className}
                  aria-description={live ? "On this page" : "Not on page"}
                  aria-current={model.className === selectedModel || undefined}
                  className={rowClass(model.className === selectedModel)}
                  onClick={() => onPickModel(model.className)}
                >
                  <BracesIcon
                    className="size-3.5 flex-none text-muted-foreground"
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "truncate font-mono",
                      !live && "text-muted-foreground"
                    )}
                  >
                    {model.className}
                  </span>
                  <span className="flex-1" />
                  <LiveMark live={live} />
                </button>
              </li>
            );
          })}
        </ul>
      </Pane>
    </div>
  );
}

function* treeRows(
  nodes: readonly PageObjectNode[],
  depth: number
): Generator<{ node: PageObjectNode; depth: number }> {
  for (const node of nodes) {
    yield { node, depth };
    yield* treeRows(node.children, depth + 1);
  }
}

function rowClass(selected: boolean) {
  return cn(
    "flex h-[30px] w-full items-center gap-[7px] rounded-md px-2 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50",
    selected && "bg-accent hover:bg-accent"
  );
}

function TreeRow({
  label,
  name = label,
  depth,
  icon: Icon,
  type,
  live,
  selected,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  /** Its accessible name: the object's path. */
  label: string;
  name?: string;
  depth: number;
  icon: LucideIcon;
  type: string;
  /** Undefined for the page itself. */
  live?: boolean;
  selected: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-label={label}
      aria-description={
        live === undefined ? undefined : live ? "On this page" : "Not on page"
      }
      className={rowClass(selected)}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Icon className="size-3.5 flex-none text-muted-foreground" aria-hidden />
      <span
        className={cn(
          "font-mono whitespace-nowrap",
          live === false && "text-muted-foreground"
        )}
      >
        {name}
      </span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {type}
      </span>
      <span className="flex-1" />
      {live !== undefined && <LiveMark live={live} />}
    </button>
  );
}

/** A live dot, or "Not on page". */
export function LiveMark({ live }: { live: boolean }) {
  return live ? (
    <span
      className="size-2 flex-none rounded-full bg-success"
      title="On this page"
      aria-hidden
    />
  ) : (
    <span className="text-[11px] whitespace-nowrap text-muted-foreground">
      Not on page
    </span>
  );
}

function Pane({
  title,
  open,
  onToggle,
  grow,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  grow: number;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title.replace(/ · \d+$/, "")}
      className={cn(
        "flex min-h-0 flex-col not-first:border-t",
        open ? "shrink basis-0" : "flex-none"
      )}
      style={open ? { flexGrow: grow } : undefined}
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex flex-none items-center gap-1.5 px-3.5 pt-[9px] pb-[7px] text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        onClick={onToggle}
      >
        <ChevronRightIcon
          className={cn("size-3 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {title}
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5">
          {children}
        </div>
      )}
    </section>
  );
}

/** The divider between the panes: drag it, or use the arrow keys. */
function Divider({
  split,
  onSplitChange,
}: {
  split: number;
  onSplitChange: (split: number) => void;
}) {
  const drag = usePointerDrag();
  const handle = useRef<HTMLDivElement>(null);
  const clamp = (value: number) =>
    Math.min(maxSplit, Math.max(minSplit, value));
  const onKeyDown = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowUp"
        ? -splitStep
        : event.key === "ArrowDown"
          ? splitStep
          : 0;
    if (!step) return;
    event.preventDefault();
    onSplitChange(clamp(split + step));
  };
  return (
    <div
      ref={handle}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the two lists"
      aria-valuemin={minSplit * 100}
      aria-valuemax={maxSplit * 100}
      aria-valuenow={Math.round(split * 100)}
      tabIndex={0}
      className="relative z-10 -my-1 h-[9px] flex-none cursor-row-resize touch-none outline-none after:absolute after:inset-x-0 after:top-1 after:h-0.5 after:bg-ring after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:opacity-100"
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        const height = handle.current?.parentElement?.offsetHeight ?? 0;
        if (!height) return;
        const start = split;
        drag(event, {
          onMove: (_deltaX, deltaY) =>
            onSplitChange(clamp(start + deltaY / height)),
        });
      }}
    />
  );
}
