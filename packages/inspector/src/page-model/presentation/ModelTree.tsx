import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
import {
  objectRows,
  revealSelection,
  type ObjectTree,
} from "../domain/objectTree";
import { Divider, QualifiedName, rowFocusRing } from "../../shared";
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
  objectTree,
  onObjectTreeChange,
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
  objectTree: ObjectTree;
  onObjectTreeChange: (objectTree: ObjectTree) => void;
}) {
  const { objectsOpen, modelsOpen, split } = panes;
  const bothOpen = objectsOpen && modelsOpen;

  const selectedPath = selection.kind === "object" ? selection.path : undefined;
  // The objects around the selection show open, and stay open once shown.
  const shown = revealSelection(objects, objectTree, selectedPath);
  const rows = [...objectRows(objects, shown.open)];
  const setOpen = (path: string, open: boolean) =>
    onObjectTreeChange({ ...shown, open: { ...shown.open, [path]: open } });
  useEffect(() => {
    if (shown !== objectTree) onObjectTreeChange(shown);
  }, [shown, objectTree, onObjectTreeChange]);

  // An object that closes on its own, as it leaves the page, takes the rows
  // under it away; focus on one of them moves to the closest row left.
  const tree = useRef<HTMLDivElement>(null);
  const focused = focusedPath(tree.current);
  useLayoutEffect(() => {
    if (focused === undefined || rows.some(({ node }) => node.path === focused))
      return;
    const kept = parentPaths(focused).find((path) =>
      rows.some(({ node }) => node.path === path)
    );
    if (kept) rowElement(tree.current, kept)?.focus();
  });
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
        <div ref={tree} role="tree" aria-label="Page objects">
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
                  <QualifiedName
                    name={model.className}
                    className={cn(
                      // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
                      "font-mono",
                      !live && "text-muted-foreground"
                    )}
                  />
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

/**
 * The paths above `path`, closest first: "A.items[1].b" gives
 * "A.items[1]", "A.items" and "A". Read from the path, so it works for an
 * object that is gone from the page model.
 */
function parentPaths(path: string): string[] {
  const parent = path.replace(/(\.[^.[\]]+|\[\d+\])$/, "");
  return parent === path ? [] : [parent, ...parentPaths(parent)];
}

/** The path of the tree's row that has focus, before this render changes it. */
function focusedPath(tree: HTMLElement | null) {
  const root = tree?.getRootNode() as Document | ShadowRoot | undefined;
  const active = root?.activeElement;
  if (!tree || !active || !tree.contains(active)) return undefined;
  return active.getAttribute("aria-label") ?? undefined;
}

function rowElement(tree: HTMLElement | null, path: string) {
  return tree?.querySelector<HTMLElement>(
    `[role="treeitem"][aria-label="${CSS.escape(path)}"]`
  );
}

function rowClass(selected: boolean) {
  return cn(
    "flex h-7.5 w-full items-center gap-1.75 rounded-md px-2 text-left hover:bg-muted",
    rowFocusRing,
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
      style={{ paddingLeft: 8 + depth * 16 }}
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
          <ChevronRightIcon className={cn("size-3", open && "rotate-90")} />
        </span>
      )}
      <Icon className="size-3.5 flex-none text-muted-foreground" aria-hidden />
      <span
        className={cn(
          // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
          "min-w-0 truncate font-mono",
          live === false && "text-muted-foreground"
        )}
        title={name}
      >
        {name}
      </span>
      {/* The type gives way first. */}
      <span className="min-w-0 shrink-[1000] truncate text-xs text-muted-foreground">
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
        className={cn(
          "flex flex-none items-center gap-1.5 px-3.5 pt-2.25 pb-1.75 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground",
          rowFocusRing
        )}
        onClick={onToggle}
      >
        <ChevronRightIcon
          // Stryker disable next-line StringLiteral,ConditionalExpression,LogicalOperator: Tailwind classes are styling, which no test reads.
          className={cn("size-3", open && "rotate-90")}
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
