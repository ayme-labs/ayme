import { BracesIcon, ChevronRightIcon, ZapIcon } from "lucide-react";

import { Empty } from "../common";
import { WhatTheModelSees } from "../detail/WhatTheModelSees";
import type { Lens } from "../frame/lens";
import { NavItem } from "../frame/NavItem";
import type { RenderRun } from "../frame/runSlot";
import type { Selection } from "../frame/selection";
import {
  listTools,
  toolKindLabels,
  type Publication,
  type PublishedTool,
} from "./toolGroups";

/**
 * The Tools lens: every tool WebMCP publishes now, grouped as Page object
 * tools, Ref tools and Agent tools. A tool's page is its description, the
 * run slot and what the model sees of it.
 */
export function toolsLens({
  tools,
  publication,
  definitions,
  selection,
  onSelect,
  renderRun,
}: {
  tools: readonly PublishedTool[];
  publication: Publication;
  /**
   * The Page Object definition an agent receives for the selected Page
   * object tool's model, once it is known.
   */
  definitions?: PomDefinitionText;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  renderRun: RenderRun;
}): Lens {
  const listing = listTools(tools, publication);
  const listed = listing.kind === "groups" ? listing.groups : [];
  const selectedTool = selection.kind === "tool" ? selection.name : undefined;
  return {
    id: "tools",
    label: "Tools",
    tree:
      listing.kind === "failed" ? (
        <p role="alert" className="p-3.5 text-center text-xs text-destructive">
          {listing.message}
        </p>
      ) : listing.kind === "empty" ? (
        <p className="p-3.5 text-center text-xs text-muted-foreground">
          No tools are published.
        </p>
      ) : (
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
                      onClick={() =>
                        onSelect({ kind: "tool", name: tool.name })
                      }
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
      if (!tool) return <Empty>{selected.name} is not published now.</Empty>;
      return (
        <ToolPage
          tool={tool}
          definitions={
            tool.pomClassName && definitions?.className === tool.pomClassName
              ? definitions.text
              : undefined
          }
          onSelect={onSelect}
          renderRun={renderRun}
        />
      );
    },
  };
}

/** A Page Object Model's definition, as get_page_context renders it. */
export type PomDefinitionText = { className: string; text: string };

/** The Page Object Model whose definition the selected tool's page shows. */
export function selectedToolModel(
  tools: readonly PublishedTool[],
  selection: Selection
) {
  if (selection.kind !== "tool") return undefined;
  return tools.find((tool) => tool.name === selection.name)?.pomClassName;
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
  tool: PublishedTool;
  definitions?: string;
  onSelect: (selection: Selection) => void;
  renderRun: RenderRun;
}) {
  const { pomClassName } = tool;
  return (
    <article aria-label={tool.name}>
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
      {renderRun({ toolName: tool.name })}
      <WhatTheModelSees
        definitions={definitions}
        schemas={[{ name: tool.name, inputSchema: tool.inputSchema }]}
      />
    </article>
  );
}
