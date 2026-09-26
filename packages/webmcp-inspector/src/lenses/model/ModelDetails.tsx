import { Fragment, type ReactNode } from "react";
import {
  BoxIcon,
  BracesIcon,
  ChevronRightIcon,
  CrosshairIcon,
  ListTreeIcon,
  MapPinIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@ayme-dev/design-system/components/badge";
import { cn } from "@ayme-dev/design-system/lib/utils";

import type {
  ObjectAction,
  PageObjectModel,
  PageObjectNode,
} from "../../adapter/pageModel";
import type { RenderRun } from "../../frame/runSlot";
import type { Highlighting } from "./highlight";

/** The page as a whole: its host and the page Page Objects on it. */
export function PageDetail({
  host,
  pages,
  modelCount,
  highlight,
  onOpenObject,
}: {
  host: string;
  pages: readonly PageObjectNode[];
  modelCount: number;
  highlight: Highlighting;
  onOpenObject: (node: PageObjectNode) => void;
}) {
  return (
    <div className="grid gap-4.5">
      <DetailHead
        title="Page /"
        kind={`${host} · ${plural(modelCount, "page object model", "page object models")}`}
      />
      <DetailSection
        title="On this page"
        count={pages.length}
        icon={MapPinIcon}
      >
        {pages.map((page) => (
          <LinkRow
            key={page.path}
            name={page.path}
            kind="page"
            live={page.live}
            onClick={() => onOpenObject(page)}
            {...highlight.hover(page.live ? page.highlightPath : undefined)}
          />
        ))}
      </DetailSection>
    </div>
  );
}

/**
 * A Page Object on the page: its model, its actions through the run slot,
 * and its members as found on the page now.
 */
export function ObjectDetail({
  node,
  highlight,
  renderRun,
  onOpenModel,
  onOpenObject,
}: {
  node: PageObjectNode;
  highlight: Highlighting;
  renderRun: RenderRun;
  onOpenModel: (className: string) => void;
  /** Goes to a child Page Object or collection, by path. */
  onOpenObject: (path: string) => void;
}) {
  const count = node.itemCount ?? 0;
  return (
    <div className="grid gap-4.5">
      <DetailHead
        title={node.path}
        model={node.className}
        onOpenModel={onOpenModel}
        kind={
          node.kind === "page"
            ? "page object"
            : node.kind === "collection"
              ? `collection · ${plural(count, "item", "items")}`
              : undefined
        }
        status={
          node.kind === "collection"
            ? { label: count ? `${count} live` : "None", live: count > 0 }
            : { label: node.live ? "Live" : "Not on page", live: node.live }
        }
      />
      {node.kind === "collection" && node.actions.length > 0 && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Collection actions run on one item.
        </p>
      )}
      <Actions actions={node.actions} renderRun={renderRun} />
      {node.members.length > 0 && (
        <DetailSection
          title="Members"
          count={node.members.length}
          icon={ListTreeIcon}
        >
          {node.members.map((member) =>
            member.objectPath !== undefined ? (
              <LinkRow
                key={member.name}
                name={member.name}
                kind={
                  member.collection
                    ? `${member.className}[]`
                    : (member.className ?? "")
                }
                state={member.state}
                live={member.live}
                icon={BoxIcon}
                onClick={() => onOpenObject(member.objectPath!)}
                {...highlight.hover(
                  member.live ? member.highlightPath : undefined
                )}
              />
            ) : (
              <PinRow
                key={member.name}
                name={member.name}
                kind="locator"
                state={member.state}
                live={member.live}
                path={member.live ? member.highlightPath : undefined}
                highlight={highlight}
              />
            )
          )}
        </DetailSection>
      )}
    </div>
  );
}

/**
 * A Page Object Model: its instances on this page, its actions (dimmed when
 * none of their tools is published) and its members.
 */
export function ModelDetail({
  model,
  instances,
  highlight,
  renderRun,
  onOpenModel,
  onOpenObject,
}: {
  model: PageObjectModel;
  /** Its Page Objects on the page now. */
  instances: readonly PageObjectNode[];
  highlight: Highlighting;
  renderRun: RenderRun;
  onOpenModel: (className: string) => void;
  onOpenObject: (node: PageObjectNode) => void;
}) {
  const onPage = instances.length > 0;
  return (
    <div className="grid gap-4.5">
      <DetailHead
        title={model.className}
        kind="Page object model"
        {...(onPage ? {} : { status: { label: "Not on page", live: false } })}
      />
      {(model.description || !onPage) && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {[
            model.description,
            !onPage &&
              `Not on this page. Its actions become tools when a ${model.className} is on the page.`,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}
      {onPage && (
        <DetailSection
          title="On this page"
          count={instances.length}
          icon={MapPinIcon}
        >
          {instances.map((instance) => (
            <LinkRow
              key={instance.path}
              name={instance.path}
              live
              onClick={() => onOpenObject(instance)}
              {...highlight.hover(instance.highlightPath)}
            />
          ))}
        </DetailSection>
      )}
      <Actions
        actions={model.actions.flatMap((action): ObjectAction[] => {
          const published = action.publishedToolNames;
          if (published.length)
            return published.map((toolName) => ({
              ...action,
              toolName,
              published: true,
            }));
          return [{ ...action, toolName: "", published: false }];
        })}
        renderRun={renderRun}
      />
      {model.members.length > 0 && (
        <DetailSection
          title="Members"
          count={model.members.length}
          icon={ListTreeIcon}
        >
          {model.members.map((member) =>
            member.kind === "component" ? (
              <LinkRow
                key={member.name}
                name={member.name}
                kind={`${member.className}${member.collection ? "[]" : ""}`}
                icon={BoxIcon}
                onClick={() => onOpenModel(member.className!)}
              />
            ) : (
              <PinRow
                key={member.name}
                name={member.name}
                kind="locator"
                path={onPage ? member.highlightPath : undefined}
                highlight={highlight}
              />
            )
          )}
        </DetailSection>
      )}
    </div>
  );
}

function DetailHead({
  title,
  kind,
  model,
  onOpenModel,
  status,
}: {
  title: string;
  kind?: string;
  /** The Page Object Model to link to. */
  model?: string;
  onOpenModel?: (className: string) => void;
  status?: { label: string; live: boolean };
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="grid min-w-0 flex-1 gap-1">
        <h3 className="font-mono text-[13.5px] font-semibold break-all">
          {title}
        </h3>
        {(model || kind) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {model && (
              <button
                type="button"
                aria-label={`Open the ${model} page object model`}
                className="inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-foreground hover:border-ring"
                onClick={() => onOpenModel?.(model)}
              >
                <BracesIcon className="size-3" aria-hidden />
                <span className="font-mono">{model}</span>
                <ChevronRightIcon className="size-3" aria-hidden />
              </button>
            )}
            {kind && <span>{kind}</span>}
          </div>
        )}
      </div>
      {status && (
        <Badge
          variant={status.live ? "secondary" : "outline"}
          className={cn(
            status.live ? "bg-success/15 text-success" : "text-muted-foreground"
          )}
        >
          {status.label}
        </Badge>
      )}
    </div>
  );
}

function DetailSection({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count: number;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-1">
      <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title} · {count}
      </h4>
      {children}
    </section>
  );
}

function Actions({
  actions,
  renderRun,
}: {
  actions: readonly ObjectAction[];
  renderRun: RenderRun;
}) {
  if (!actions.length) return null;
  return (
    <DetailSection title="Actions" count={actions.length} icon={ZapIcon}>
      <div className="grid gap-2">
        {actions.map((action) =>
          action.published ? (
            <Fragment key={action.toolName}>
              {renderRun({ toolName: action.toolName })}
            </Fragment>
          ) : (
            <UnpublishedAction key={action.name} action={action} />
          )
        )}
      </div>
    </DetailSection>
  );
}

/** An action whose tool WebMCP doesn't publish now: shown, but not runnable. */
function UnpublishedAction({ action }: { action: ObjectAction }) {
  return (
    <div
      role="group"
      aria-label={action.name}
      aria-disabled
      className="grid gap-1 rounded-lg border border-dashed px-3 py-2.5 opacity-60"
    >
      <div className="flex items-center gap-1.5">
        <ZapIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono text-[12.5px] font-semibold">
          {action.name}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {action.signature}
        </span>
        <span className="flex-1" />
        <Badge variant="outline" className="text-muted-foreground">
          Not published
        </Badge>
      </div>
      {action.description && (
        <p className="text-xs text-muted-foreground">{action.description}</p>
      )}
    </div>
  );
}

const rowClass =
  "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** A row that goes somewhere: a child Page Object, an instance or a model. */
function LinkRow({
  name,
  kind,
  state,
  live,
  icon: Icon,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  name: string;
  kind?: string;
  state?: string;
  /** Undefined on a model's members, which are on no page. */
  live?: boolean;
  icon?: LucideIcon;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-description={describe(kind, state)}
      className={rowClass}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <MemberName
        name={name}
        kind={kind}
        state={state}
        live={live}
        icon={Icon}
      />
      <ChevronRightIcon
        className="size-3.5 flex-none text-muted-foreground"
        aria-hidden
      />
    </button>
  );
}

/** A locator: hovering highlights it on the page, clicking pins that. */
function PinRow({
  name,
  kind,
  state,
  live,
  path,
  highlight,
}: {
  name: string;
  kind: string;
  state?: string;
  live?: boolean;
  /** Its highlight path, when it can be highlighted now. */
  path: string | undefined;
  highlight: Highlighting;
}) {
  const pinned = highlight.isPinned(path);
  return (
    <button
      type="button"
      aria-label={name}
      aria-description={describe(kind, state)}
      aria-pressed={pinned}
      disabled={path === undefined}
      title={
        path === undefined ? undefined : "Hover to highlight, click to pin"
      }
      className={cn(
        rowClass,
        "cursor-crosshair disabled:cursor-default disabled:hover:bg-transparent",
        pinned && "bg-accent hover:bg-accent"
      )}
      onClick={() => path !== undefined && highlight.togglePin(path)}
      {...highlight.hover(path)}
    >
      <MemberName
        name={name}
        kind={kind}
        state={state}
        live={live}
        icon={CrosshairIcon}
      />
    </button>
  );
}

function MemberName({
  name,
  kind,
  state,
  live,
  icon: Icon,
}: {
  name: string;
  kind?: string;
  state?: string;
  live?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <>
      {live !== undefined && (
        <span
          className={cn(
            "size-2 flex-none rounded-full",
            live
              ? "bg-success"
              : "shadow-[inset_0_0_0_1.5px_var(--color-muted-foreground)]"
          )}
          aria-hidden
        />
      )}
      {Icon && (
        <Icon
          className="size-3.5 flex-none text-muted-foreground"
          aria-label={Icon === CrosshairIcon ? "Locator" : "Page object"}
        />
      )}
      <span
        className={cn(
          "truncate font-mono text-[12.5px]",
          live === false && "text-muted-foreground"
        )}
      >
        {name}
      </span>
      {kind && (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {kind}
        </span>
      )}
      <span className="flex-1" />
      {state && (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {state}
        </span>
      )}
    </>
  );
}

function describe(kind: string | undefined, state: string | undefined) {
  return [kind, state].filter(Boolean).join(" · ") || undefined;
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
