import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
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

import type { PageObjectModel, PageObjectNode } from "../domain/pageModel";
import { Divider } from "../../shared";
import {
  defaultPreferences,
  maxModelSplit as maxSplit,
  minModelSplit as minSplit,
  type ModelPanes,
} from "../../panel";
import type { OnHover, Selection } from "../../navigation";
import { hoverHandlers } from "../view/hover";
import { LiveMark } from "../view/LiveMark";

const splitStep = 0.05;

/**
 * The objects the person opened or closed in the tree by hand, by path. The
 * rest are open while they are on the page and closed while they aren't.
 */
export type OpenObjects = Readonly<Record<string, boolean>>;

const kindIcon: Record<PageObjectNode["kind"], LucideIcon> = {
  page: FileIcon,
  component: BoxIcon,
  collection: LayersIcon,
  item: BoxIcon,
};

/**
 * The Model lens's tree: the Page Objects on this page, and the Page Object
 * Models the page knows. Each pane collapses to its header; when both are
 * open, a divider between them shares the height out. An object not on the
 * page starts closed, so what isn't there takes one row.
 */
export function ModelTree({
  host,
  objects,
  models,
  liveCount,
  selection,
  onHover,
  onPickPage,
  onPickObject,
  onPickModel,
  panes,
  onPanesChange,
  openObjects,
  onOpenObjectsChange,
}: {
  /** The page's host, e.g. localhost:5173. */
  host: string;
  objects: readonly PageObjectNode[];
  models: readonly PageObjectModel[];
  /** How many Page Objects are on the page now. */
  liveCount: number;
  selection: Selection;
  /** Called with what the pointer is over, for the page's dashed highlight. */
  onHover: OnHover;
  onPickPage: () => void;
  onPickObject: (node: PageObjectNode) => void;
  onPickModel: (className: string) => void;
  /** Which panes are open and how they share the height; the panel keeps it. */
  panes: ModelPanes;
  onPanesChange: (panes: ModelPanes) => void;
  openObjects: OpenObjects;
  onOpenObjectsChange: (openObjects: OpenObjects) => void;
}) {
  const { objectsOpen, modelsOpen, split } = panes;
  const bothOpen = objectsOpen && modelsOpen;

  const selectedPath = selection.kind === "object" ? selection.path : undefined;
  const rows = [...treeRows(objects, 1, openObjects)];
  const setOpen = (path: string, open: boolean) =>
    onOpenObjectsChange({ ...openObjects, [path]: open });

  // A selection inside a closed object, from search or a link, opens the
  // objects around it.
  useEffect(() => {
    if (selectedPath === undefined) return;
    const closed = ancestors(objects, selectedPath).filter(
      (node) => !isOpen(node, openObjects)
    );
    if (!closed.length) return;
    onOpenObjectsChange({
      ...openObjects,
      ...Object.fromEntries(closed.map((node) => [node.path, true])),
    });
    // Only a new selection opens its objects, not a later close.
  }, [selectedPath]);
  const selectedModel =
    selection.kind === "model" ? selection.className : undefined;

  return (
    <div className="-m-1.5 flex h-[calc(100%+12px)] min-h-0 flex-col">
      <Pane
        title={`On this page · ${liveCount}`}
        open={objectsOpen}
        onToggle={() => onPanesChange({ ...panes, objectsOpen: !objectsOpen })}
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
          {rows.map(({ node, depth, open }) => (
            <TreeRow
              key={node.key}
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
              open={open}
              onOpenChange={(next) => setOpen(node.path, next)}
              selected={node.path === selectedPath}
              onClick={() => onPickObject(node)}
              {...hoverHandlers(
                onHover,
                node.live ? { path: node.path } : undefined
              )}
            />
          ))}
        </div>
      </Pane>
      {bothOpen && (
        <SplitDivider
          split={split}
          onSplitChange={(next) => onPanesChange({ ...panes, split: next })}
        />
      )}
      <Pane
        title={`Page object models · ${models.length}`}
        open={modelsOpen}
        onToggle={() => onPanesChange({ ...panes, modelsOpen: !modelsOpen })}
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

/** The rows the tree shows: each object, and the children of the open ones. */
function* treeRows(
  nodes: readonly PageObjectNode[],
  depth: number,
  openObjects: OpenObjects
): Generator<{ node: PageObjectNode; depth: number; open?: boolean }> {
  for (const node of nodes) {
    if (!node.children.length) {
      yield { node, depth };
      continue;
    }
    const open = isOpen(node, openObjects);
    yield { node, depth, open };
    if (open) yield* treeRows(node.children, depth + 1, openObjects);
  }
}

function isOpen(node: PageObjectNode, openObjects: OpenObjects) {
  return openObjects[node.path] ?? node.live;
}

/** The objects above the one at `path`, outermost first. */
function ancestors(
  nodes: readonly PageObjectNode[],
  path: string
): PageObjectNode[] {
  for (const node of nodes) {
    if (node.path === path) return [];
    const below = ancestors(node.children, path);
    if (below.length || node.children.some((child) => child.path === path))
      return [node, ...below];
  }
  return [];
}

function rowClass(selected: boolean) {
  return cn(
    "flex h-7.5 w-full items-center gap-1.75 rounded-md px-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
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
  open,
  onOpenChange,
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
  /** Whether its children show; undefined when it has none. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  selected: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  // The tree's keys: right opens an object, left closes it.
  const onKeyDown = (event: KeyboardEvent) => {
    const next = { ArrowRight: true, ArrowLeft: false }[event.key];
    if (open === undefined || next === undefined || next === open) return;
    event.preventDefault();
    onOpenChange?.(next);
  };
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={open}
      aria-selected={selected}
      aria-label={label}
      aria-description={
        live === undefined ? undefined : live ? "On this page" : "Not on page"
      }
      className={rowClass(selected)}
      style={{ paddingLeft: 4 + depth * 16 }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {open === undefined ? (
        <span className="size-3 flex-none" />
      ) : (
        <span
          aria-hidden
          data-toggle
          className="-mr-0.5 flex size-3 flex-none items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onOpenChange?.(!open);
          }}
        >
          <ChevronRightIcon
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
        </span>
      )}
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
        className="flex flex-none items-center gap-1.5 px-3.5 pt-2.25 pb-1.75 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
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

/**
 * The divider between the panes, on the second pane's top border: drag it,
 * use the arrow keys, or double-click it for the default share.
 */
function SplitDivider({
  split,
  onSplitChange,
}: {
  split: number;
  onSplitChange: (split: number) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  // The divider works in percent, so its value reads as one.
  return (
    <div ref={handle} className="contents">
      <Divider
        orientation="horizontal"
        border="after"
        label="Resize the two lists"
        value={split * 100}
        min={minSplit * 100}
        max={maxSplit * 100}
        step={splitStep * 100}
        perPixel={() => {
          const height = handle.current?.parentElement?.offsetHeight ?? 0;
          return height ? 100 / height : 0;
        }}
        onChange={(percent) => onSplitChange(percent / 100)}
        onReset={() => onSplitChange(defaultPreferences.modelPanes.split)}
      />
    </div>
  );
}
