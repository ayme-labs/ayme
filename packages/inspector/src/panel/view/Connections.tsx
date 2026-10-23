import { CheckIcon, CopyIcon } from "lucide-react";
import { Popover } from "radix-ui";

import { usePortalContainer } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

import {
  agentPill,
  agentRow,
  webMcpBroken,
  webMcpRow,
  webMcpToolCount,
  type AgentConnectionStatus,
  type ConnectionRow,
  type PublicationStatus,
  type Tone,
} from "../domain/connections";
import { focusRing, pressable, pressableIcon } from "../../shared";

const DOCS =
  "https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md";

// Stryker disable StringLiteral,ObjectLiteral: Tailwind classes are styling, which no test reads.
const dotClass: Record<Tone, string> = {
  off: "border-[1.5px] border-muted-foreground",
  waiting: "border-2 border-warning",
  ok: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
};

const labelClass: Record<Tone, string> = {
  off: "text-muted-foreground",
  waiting: "text-warning",
  ok: "text-success",
  warning: "text-warning",
  error: "text-destructive",
};
// Stryker restore StringLiteral,ObjectLiteral

/** A path's dot, whose `data-tone` tests read. */
function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      data-tone={tone}
      // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
      className={cn("size-2 flex-none rounded-full", dotClass[tone])}
    />
  );
}

/**
 * The header's pill, which says how the agent reaches the page, and the
 * Connections popover it opens: one row for the Agent Connection and one
 * for WebMCP. A corner mark on the pill says WebMCP is on and broken.
 */
export function Connections({
  agent,
  webMCP,
  tools,
  onCopy,
  copied,
}: {
  agent: AgentConnectionStatus;
  webMCP: PublicationStatus;
  /** The tools the session lists, which WebMCP publishes but for some. */
  tools: readonly Readonly<{ name: string; group?: string }>[];
  onCopy: (text: string) => void;
  /** The snippet just copied, whose Copy says so. */
  copied?: string;
}) {
  const container = usePortalContainer();
  const pill = agentPill(agent);
  const broken = webMcpBroken(webMCP);
  const name = `Connections: ${pill.label}${broken ? `, WebMCP ${webMCP.state}` : ""}`;
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={name}
        title={name}
        // Stryker disable StringLiteral,ConditionalExpression,LogicalOperator,EqualityOperator: Tailwind classes are styling, which no test reads.
        className={cn(
          "relative ml-0.5 inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-muted pr-2.5 pl-2 text-xs font-medium hover:bg-accent aria-expanded:bg-accent",
          focusRing,
          pressable,
          agent.state === "off" && "text-muted-foreground"
        )}
        // Stryker restore StringLiteral,ConditionalExpression,LogicalOperator,EqualityOperator
      >
        <Dot tone={pill.tone} />
        <span className="truncate">{pill.text}</span>
        {broken && (
          <span
            aria-hidden
            data-webmcp-mark={webMCP.state}
            // Stryker disable StringLiteral,ConditionalExpression,EqualityOperator: Tailwind classes are styling, which no test reads.
            className={cn(
              "absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background",
              webMCP.state === "failed" ? "bg-destructive" : "bg-warning"
            )}
            // Stryker restore StringLiteral,ConditionalExpression,EqualityOperator
          />
        )}
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          aria-label="Connections"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex w-78 max-w-(--radix-popover-content-available-width) origin-(--radix-popover-content-transform-origin) flex-col gap-3 rounded-lg border bg-popover p-4 pt-3.5 text-popover-foreground shadow-lg outline-none transition-[opacity,scale] duration-(--duration-fast) ease-(--ease-out) starting:opacity-0 motion-safe:starting:scale-[0.97]"
        >
          <h3 className="text-sm font-semibold">Connections</h3>
          <Row
            name="Agent"
            row={agentRow(agent)}
            onCopy={onCopy}
            copied={copied}
          />
          <Row
            name="WebMCP"
            row={webMcpRow(webMCP, webMcpToolCount(tools))}
            onCopy={onCopy}
            copied={copied}
          />
          <a
            href={DOCS}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Connecting an agent, in the docs
          </a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One path: its dot, name and state, what that means, and its option when off. */
function Row({
  name,
  row,
  onCopy,
  copied,
}: {
  name: string;
  row: ConnectionRow;
  onCopy: (text: string) => void;
  copied: string | undefined;
}) {
  return (
    <section
      aria-label={name}
      className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <Dot tone={row.tone} />
        <h4 className="flex-1 text-xs font-semibold">{name}</h4>
        <span
          // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
          className={cn("text-xs font-medium", labelClass[row.tone])}
        >
          {row.label}
        </span>
      </div>
      {row.lines.map((line, index) => (
        <p
          key={line}
          // Stryker disable StringLiteral,ConditionalExpression,LogicalOperator,EqualityOperator: Tailwind classes are styling, which no test reads.
          className={cn(
            "text-xs break-words",
            // What went wrong reads stronger than its fix.
            index === 0 && row.tone !== "off" && row.tone !== "ok"
              ? "text-foreground"
              : "text-muted-foreground"
          )}
          // Stryker restore StringLiteral,ConditionalExpression,LogicalOperator,EqualityOperator
        >
          {line}
        </p>
      ))}
      {row.snippet && (
        <div className="flex items-center gap-1.5">
          <span role="status" className="sr-only">
            {copied === row.snippet ? "Copied" : ""}
          </span>
          <code className="flex-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] select-all">
            {row.snippet}
          </code>
          <button
            type="button"
            aria-label={`Copy ${row.snippet}`}
            title={copied === row.snippet ? "Copied" : "Copy"}
            className={cn(
              "inline-grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
              focusRing,
              pressableIcon
            )}
            onClick={() => onCopy(row.snippet!)}
          >
            {copied === row.snippet ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
          </button>
        </div>
      )}
    </section>
  );
}
