import { BracesIcon, ChevronRightIcon, ZapIcon } from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import {
  chip,
  DestructiveIcon,
  DestructiveMark,
  QualifiedName,
} from "../../shared/view";
import { WhatTheModelSees } from "../../shared/presentation";
import {
  type Lens,
  type RenderRun,
  type Selection,
} from "../../navigation/domain";
import { NavItem } from "../../navigation/view";
import { listTools, toolKindLabels, type LiveTool } from "../domain/toolGroups";

/**
 * The Tools lens: every live tool, the ones the panel can run now whether
 * WebMCP publishes them or not, grouped as Page object tools, Custom tools, Browser tools,
 * Peek tools and Agent tools. A tool's page is its description, the run slot
 * and what the model sees of it.
 */
export function toolsLens({
  tools,
  definitionText,
  selection,
  onSelect,
  renderRun,
}: {
  tools: readonly LiveTool[];
  /**
   * A Page Object Model's definition as snapshot gives it to an
   * agent. Reading it must not capture the page.
   */
  definitionText: (className: string) => string;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  renderRun: RenderRun;
}): Lens {
  const listed = listTools(tools);
  const selectedTool = selection.kind === "tool" ? selection.name : undefined;
  return {
    id: "tools",
    label: "Tools",
    tree: (
      <div className="flex flex-col">
        {listed.map(({ group, label, tools }) => (
          <section key={group} aria-labelledby={`tool-group-${group}`}>
            <h3
              id={`tool-group-${group}`}
              className="mx-2 mt-3.5 mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
            >
              {label} · {tools.length}
            </h3>
            <ul aria-label={label}>
              {tools.map((tool) => (
                <li key={tool.name} className="relative">
                  <NavItem
                    // Named by the name whole: its two parts would read apart.
                    aria-label={tool.name}
                    aria-description={
                      tool.destructive ? "Destructive" : undefined
                    }
                    selected={tool.name === selectedTool}
                    onClick={() => onSelect({ kind: "tool", name: tool.name })}
                  >
                    {tool.destructive ? (
                      <DestructiveIcon />
                    ) : (
                      <ZapIcon
                        className="size-3.5 flex-none text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <QualifiedName
                      name={tool.name}
                      className="font-mono text-xs"
                    />
                  </NavItem>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    ),
    searchEntries: listed.flatMap(({ tools }) =>
      tools.map((tool) => ({
        key: `tool:${tool.name}`,
        kind: "Tool",
        label: tool.name,
        description: tool.agentDescription,
        selection: { kind: "tool", name: tool.name } as const,
      }))
    ),
    legend: {},
    detail: (selected) => {
      if (selected.kind !== "tool") return undefined;
      const tool = listed
        .flatMap(({ tools }) => tools)
        .find((candidate) => candidate.name === selected.name);
      // A tool that is no longer live has no page: the selection is stale,
      // and the app falls back.
      if (!tool) return undefined;
      return (
        <ToolPage
          tool={tool}
          definitions={
            tool.className
              ? readDefinition(definitionText, tool.className)
              : undefined
          }
          onSelect={onSelect}
          renderRun={renderRun}
        />
      );
    },
  };
}

/** The model's definition, or none when the runtime can't give one. */
function readDefinition(
  definitionText: (className: string) => string,
  className: string
) {
  try {
    return definitionText(className) || undefined;
  } catch (error) {
    // E.g. two different models share the name: the agent gets none either.
    console.warn(`No definition for ${className}: ${String(error)}`);
    return undefined;
  }
}

/**
 * A tool's page: its name, kind and description, then the run slot with Run
 * at its foot, then what the model sees.
 */
function ToolPage({
  tool,
  definitions,
  onSelect,
  renderRun,
}: {
  tool: LiveTool;
  definitions?: string;
  onSelect: (selection: Selection) => void;
  renderRun: RenderRun;
}) {
  const { className } = tool;
  return (
    <article aria-label={tool.name} data-tool-page>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 font-mono text-sm font-semibold [overflow-wrap:anywhere]">
          {tool.name}
        </h2>
        {tool.destructive && <DestructiveMark />}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {className && (
          <button
            type="button"
            aria-label={`Open the ${className} page object model`}
            title={`Open the ${className} page object model`}
            onClick={() => onSelect({ kind: "model", className })}
            // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
            className={cn(chip, "text-foreground")}
          >
            <BracesIcon className="size-3" aria-hidden />
            <span className="min-w-0 truncate font-mono" title={className}>
              {className}
            </span>
            <ChevronRightIcon className="size-3" aria-hidden />
          </button>
        )}
        <span data-tool-kind>{toolKindLabels[tool.group]}</span>
      </div>
      {tool.agentDescription ? (
        <p className="mt-2 mb-3 text-xs leading-normal text-muted-foreground [overflow-wrap:anywhere]">
          {tool.agentDescription}
        </p>
      ) : (
        // The run slot keeps its place below the head.
        <div className="mb-3" />
      )}
      {renderRun({ toolName: tool.name, head: false })}
      <WhatTheModelSees
        definitions={definitions}
        schemas={[{ name: tool.name, inputSchema: tool.inputSchema }]}
      />
    </article>
  );
}
