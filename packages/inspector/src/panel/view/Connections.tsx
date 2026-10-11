import { CopyIcon } from "lucide-react";
import { Popover } from "radix-ui";

import { usePortalContainer } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

import {
  agentPill,
  agentRow,
  webMcpBroken,
  webMcpRow,
  type AgentConnectionStatus,
  type ConnectionRow,
  type PublicationStatus,
  type Tone,
} from "../domain/connections";

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

function Dot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
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
}: {
  agent: AgentConnectionStatus;
  webMCP: PublicationStatus;
  /** How many tools the session lists, which WebMCP publishes. */
  tools: number;
  onCopy: (text: string) => void;
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
        className={cn(
          "relative ml-0.5 inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-muted pr-2.5 pl-2 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-accent",
          agent.state === "off" && "text-muted-foreground"
        )}
      >
        <Dot tone={pill.tone} />
        <span className="truncate">{pill.text}</span>
        {broken && (
          <span
            aria-hidden
            className={cn(
              "absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background",
              webMCP.state === "failed" ? "bg-destructive" : "bg-warning"
            )}
          />
        )}
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          aria-label="Connections"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex w-78 max-w-(--radix-popover-content-available-width) flex-col gap-3 rounded-lg border bg-popover p-4 pt-3.5 text-popover-foreground shadow-md outline-none"
        >
          <h3 className="text-sm font-medium">Connections</h3>
          <Row name="Agent" row={agentRow(agent)} onCopy={onCopy} />
          <Row name="WebMCP" row={webMcpRow(webMCP, tools)} onCopy={onCopy} />
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
}: {
  name: string;
  row: ConnectionRow;
  onCopy: (text: string) => void;
}) {
  return (
    <section
      aria-label={name}
      className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <Dot tone={row.tone} />
        <h4 className="flex-1 text-[13px] font-medium">{name}</h4>
        <span className={cn("text-xs font-medium", labelClass[row.tone])}>
          {row.label}
        </span>
      </div>
      {row.lines.map((line, index) => (
        <p
          key={line}
          className={cn(
            "text-xs break-words",
            // What went wrong reads stronger than its fix.
            index === 0 && row.tone !== "off" && row.tone !== "ok"
              ? "text-foreground"
              : "text-muted-foreground"
          )}
        >
          {line}
        </p>
      ))}
      {row.snippet && (
        <div className="flex items-center gap-1.5">
          <code className="flex-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] select-all">
            {row.snippet}
          </code>
          <button
            type="button"
            aria-label={`Copy ${row.snippet}`}
            title="Copy"
            className="inline-grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => onCopy(row.snippet!)}
          >
            <CopyIcon className="size-3.5" />
          </button>
        </div>
      )}
    </section>
  );
}
