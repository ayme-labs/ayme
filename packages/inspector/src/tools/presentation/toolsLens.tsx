import { BracesIcon, ChevronRightIcon, ZapIcon } from "lucide-react";

import { WhatTheModelSees } from "../../shared";
import {
  type Lens,
  NavItem,
  type RenderRun,
  type Selection,
} from "../../navigation";
import { listTools, toolKindLabels, type LiveTool } from "../domain/toolGroups";

/**
 * The Tools lens: every live tool, the ones the panel can run now whether
 * WebMCP publishes them or not, grouped as Page object tools, Custom tools, Browser tools and
 * Agent tools. A tool's page is its description, the
 * run slot and what the model sees of it.
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
              className="mx-2 mt-3.5 mb-1 text-[10.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
            >
              {label} · {tools.length}
            </h3>
            <ul aria-label={label}>
              {tools.map((tool) => (
                <li key={tool.name}>
                  <NavItem
                    selected={tool.name === selectedTool}
                    onClick={() => onSelect({ kind: "tool", name: tool.name })}
                  >
                    <ZapIcon
                      className="size-3.5 flex-none text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate font-mono">{tool.name}</span>
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
        description: tool.description,
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
            tool.pomClassName
              ? readDefinition(definitionText, tool.pomClassName)
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
  const { pomClassName } = tool;
  return (
    <article aria-label={tool.name} data-tool-page>
      <h2 className="font-mono text-[13.5px] font-semibold">{tool.name}</h2>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {pomClassName && (
          <button
            type="button"
            aria-label={`Open the ${pomClassName} page object model`}
            title={`Open the ${pomClassName} page object model`}
            onClick={() => onSelect({ kind: "model", className: pomClassName })}
            className="inline-flex h-[22px] items-center gap-1 rounded-md border bg-card px-1.5 text-[11.5px] text-primary hover:border-ring"
          >
            <BracesIcon className="size-3" aria-hidden />
            <span className="font-mono">{pomClassName}</span>
            <ChevronRightIcon className="size-3" aria-hidden />
          </button>
        )}
        <span>{toolKindLabels[tool.group]}</span>
      </div>
      <p className="mt-2 mb-3 text-xs text-muted-foreground">
        {tool.description}
      </p>
      {renderRun({ toolName: tool.name, head: false })}
      <WhatTheModelSees
        definitions={definitions}
        schemas={[{ name: tool.name, inputSchema: tool.inputSchema }]}
      />
    </article>
  );
}
