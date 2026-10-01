import { Fragment, type ReactNode } from "react";
import {
  BoxIcon,
  BracesIcon,
  ChevronRightIcon,
  CrosshairIcon,
  ListTreeIcon,
  MapPinIcon,
  WrenchIcon,
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
import type { OnHover } from "../../frame/highlight";
import { hoverHandlers } from "./hover";

/**
 * The page as a whole: its host, the page Page Objects on it, and the
 * page-wide tools such as get_page_context.
 */
export function PageDetail({
  host,
  pages,
  modelCount,
  tools,
  renderRun,
  onHover,
  onOpenObject,
}: {
  host: string;
  pages: readonly PageObjectNode[];
  modelCount: number;
  /** The page-wide tools, run through the run slot. */
  tools: readonly string[];
  renderRun: RenderRun;
  /** Called with what the pointer is over, for the page's dashed highlight. */
  onHover: OnHover;
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
            {...hoverHandlers(
              onHover,
              page.live ? { path: page.path } : undefined
            )}
          />
        ))}
      </DetailSection>
      {tools.length > 0 && (
        <DetailSection title="Tools" count={tools.length} icon={WrenchIcon}>
          <div className="grid gap-2">
            {tools.map((toolName) => (
              <Fragment key={toolName}>{renderRun({ toolName })}</Fragment>
            ))}
          </div>
        </DetailSection>
      )}
    </div>
  );
}

/**
 * A Page Object on the page: its model, its actions through the run slot,
 * and its members as found on the page now.
 */
export function ObjectDetail({
  node,
  onHover,
  renderRun,
  onOpenModel,
  onOpenObject,
  onSelectMember,
}: {
  node: PageObjectNode;
  /** Called with what the pointer is over, for the page's dashed highlight. */
  onHover: OnHover;
  renderRun: RenderRun;
  onOpenModel: (className: string) => void;
  /** Goes to a child Page Object or collection, by path. */
  onOpenObject: (path: string) => void;
  /** Selects one of its members, by path. */
  onSelectMember: (path: string) => void;
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
            node.kind === "collection" ? (
              <LinkRow
                key={member.name}
                name={member.name}
                kind={member.className ?? ""}
                state={member.state}
                live={member.live}
                icon={BoxIcon}
                onClick={() => onOpenObject(member.path)}
                {...hoverHandlers(
                  onHover,
                  member.live ? { path: member.path } : undefined
                )}
              />
            ) : (
              <MemberRow
                key={member.name}
                name={member.name}
                kind={memberKind(member)}
                locator={member.kind === "locator"}
                state={member.state}
                live={member.live}
                path={member.live ? member.path : undefined}
                onHover={onHover}
                onSelect={onSelectMember}
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
 * none of their tools is live, i.e. no Page Object of it is on the page) and
 * its members.
 */
export function ModelDetail({
  model,
  instances,
  onHover,
  renderRun,
  onOpenModel,
  onOpenObject,
  onSelectMember,
}: {
  model: PageObjectModel;
  /** Its Page Objects on the page now. */
  instances: readonly PageObjectNode[];
  /** Called with what the pointer is over, for the page's dashed highlight. */
  onHover: OnHover;
  renderRun: RenderRun;
  onOpenModel: (className: string) => void;
  onOpenObject: (node: PageObjectNode) => void;
  /** Selects one of its members, by path. */
  onSelectMember: (path: string) => void;
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
              {...hoverHandlers(onHover, { path: instance.path })}
            />
          ))}
        </DetailSection>
      )}
      <Actions
        actions={model.actions.flatMap((action): ObjectAction[] => {
          const live = action.liveToolNames;
          if (live.length)
            return live.map((toolName) => ({
              ...action,
              toolName,
              live: true,
            }));
          return [{ ...action, toolName: "", live: false }];
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
            // Off the page, a child Page Object member still leads to its model.
            !onPage && member.className ? (
              <LinkRow
                key={member.name}
                name={member.name}
                kind={memberKind(member)}
                icon={BoxIcon}
                onClick={() => onOpenModel(member.className!)}
              />
            ) : (
              <MemberRow
                key={member.name}
                name={member.name}
                kind={memberKind(member)}
                locator={member.kind === "locator"}
                path={onPage ? member.path : undefined}
                onHover={onHover}
                onSelect={onSelectMember}
              />
            )
          )}
        </DetailSection>
      )}
    </div>
  );
}

/** A selected member, with where it sits and what the page has of it. */
export type MemberView = {
  /** Its path, e.g. "ListPage.addItemButton" or "ListItem.nameButton". */
  path: string;
  name: string;
  kind: "locator" | "component";
  className?: string;
  collection?: boolean;
  live: boolean;
  /** What the page has of it now, e.g. "2 matches" or "not on the page". */
  state: string;
  /** The Page Object it belongs to, or the model for a model's member. */
  owner:
    { kind: "object"; path: string } | { kind: "model"; className: string };
  /** A child Page Object's or collection's path on the page. */
  objectPath?: string;
};

/**
 * A Page Object member: what it is, its owner, how get_page_context declares
 * it, what the page has of it now, and for a child Page Object a way to it.
 */
export function MemberDetail({
  member,
  onHover,
  onOpenModel,
  onOpenObject,
}: {
  member: MemberView;
  onHover: OnHover;
  onOpenModel: (className: string) => void;
  onOpenObject: (path: string) => void;
}) {
  const locator = member.kind === "locator";
  const kind = memberKind(member);
  const { owner } = member;
  const ownerLabel = owner.kind === "object" ? owner.path : owner.className;
  return (
    <div className="grid gap-4.5">
      <DetailHead
        title={member.path}
        kind={`${locator ? "Locator" : "Child page object"} · ${kind}`}
        {...(member.className ? { model: member.className, onOpenModel } : {})}
        status={{
          label: member.live ? "Live" : "Not on page",
          live: member.live,
        }}
      />
      <dl className="grid gap-1.5 text-xs">
        <Fact term="Owner">
          <button
            type="button"
            aria-label={`Open its owner ${ownerLabel}`}
            className="inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 font-mono hover:border-ring"
            onClick={() =>
              owner.kind === "object"
                ? onOpenObject(owner.path)
                : onOpenModel(owner.className)
            }
            {...hoverHandlers(
              onHover,
              owner.kind === "object" ? { path: owner.path } : undefined
            )}
          >
            {owner.kind === "object" ? (
              <BoxIcon className="size-3" aria-hidden />
            ) : (
              <BracesIcon className="size-3" aria-hidden />
            )}
            {ownerLabel}
            <ChevronRightIcon className="size-3" aria-hidden />
          </button>
        </Fact>
        <Fact term="Declared as">
          <code className="font-mono">
            {locator ? member.name : `${member.name}: ${kind}`}
          </code>
        </Fact>
        <Fact term="On the page">{member.state}</Fact>
        {member.objectPath !== undefined && (
          <Fact term="Page object">
            <button
              type="button"
              aria-label={`Open ${member.objectPath}`}
              className="inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 font-mono hover:border-ring"
              onClick={() => onOpenObject(member.objectPath!)}
            >
              <BoxIcon className="size-3" aria-hidden />
              {member.objectPath}
              <ChevronRightIcon className="size-3" aria-hidden />
            </button>
          </Fact>
        )}
      </dl>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={term}
      className="grid grid-cols-[110px_1fr] items-center gap-2"
    >
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
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
          action.live ? (
            <Fragment key={action.toolName}>
              {renderRun({ toolName: action.toolName })}
            </Fragment>
          ) : (
            <OffPageAction key={action.name} action={action} />
          )
        )}
      </div>
    </DetailSection>
  );
}

/**
 * An action whose tool isn't live, since its Page Object isn't on the page:
 * shown, but not runnable.
 */
function OffPageAction({ action }: { action: ObjectAction }) {
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
          Not on page
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

/**
 * A member of a Page Object or model: hovering it highlights it on the page
 * (dashed), and clicking selects it (solid). A member not on the page can't
 * be selected.
 */
function MemberRow({
  name,
  kind,
  locator,
  state,
  live,
  path,
  onHover,
  onSelect,
}: {
  name: string;
  kind: string;
  /** A locator, or a child Page Object. */
  locator: boolean;
  state?: string;
  live?: boolean;
  /** Its path, when it is on the page now. */
  path: string | undefined;
  onHover: OnHover;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-description={describe(kind, state)}
      disabled={path === undefined}
      title={path === undefined ? "Not on the page" : undefined}
      className={cn(
        rowClass,
        "disabled:cursor-default disabled:hover:bg-transparent"
      )}
      onClick={() => path !== undefined && onSelect(path)}
      {...hoverHandlers(onHover, path === undefined ? undefined : { path })}
    >
      <MemberName
        name={name}
        kind={kind}
        state={state}
        live={live}
        icon={locator ? CrosshairIcon : BoxIcon}
      />
    </button>
  );
}

/** A member's kind: "locator", or its child Page Object's model. */
function memberKind(member: {
  kind: "locator" | "component";
  className?: string;
  collection?: boolean;
}) {
  if (member.kind === "locator") return "locator";
  return `${member.className}${member.collection ? "[]" : ""}`;
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
