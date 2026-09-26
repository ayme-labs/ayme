import { ZapIcon } from "lucide-react";

import { Badge } from "@ayme-dev/design-system/components/badge";

import { Json } from "../common";
import type { Lens } from "../frame/lens";
import { NavItem } from "../frame/NavItem";
import type { RenderRun } from "../frame/runSlot";
import type { Selection } from "../frame/selection";

/** A tool as the skeleton lists it. */
export type ToolSummary = {
  name: string;
  description: string;
  inputSchema: unknown;
  /** Whether WebMCP publishes it now. */
  available: boolean;
};

/**
 * The Tools lens. Ticket G replaces this skeleton, which lists every
 * registered tool; a tool's detail is its description, schema and run slot.
 */
export function toolsLens({
  tools,
  selection,
  onSelect,
  renderRun,
}: {
  tools: readonly ToolSummary[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  renderRun: RenderRun;
}): Lens {
  const selectedTool = selection.kind === "tool" ? selection.name : undefined;
  return {
    id: "tools",
    label: "Tools",
    tree: (
      <ul aria-label="Tools">
        {tools.map((tool) => (
          <li key={tool.name}>
            <NavItem
              selected={tool.name === selectedTool}
              onClick={() => onSelect({ kind: "tool", name: tool.name })}
            >
              <ZapIcon className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="truncate font-mono">{tool.name}</span>
            </NavItem>
          </li>
        ))}
      </ul>
    ),
    searchEntries: tools.map((tool) => ({
      key: `tool:${tool.name}`,
      kind: "Action",
      label: tool.name,
      description: tool.description,
      selection: { kind: "tool", name: tool.name },
    })),
    legend: {},
    detail: (selected) => {
      if (selected.kind !== "tool") return undefined;
      const tool = tools.find((candidate) => candidate.name === selected.name);
      if (!tool) return undefined;
      return (
        <div className="grid gap-3">
          <div className="flex items-start gap-2">
            <div className="grid flex-1 gap-0.5">
              <div className="font-mono text-[13.5px] font-semibold">
                {tool.name}
              </div>
              <p className="text-xs text-muted-foreground">
                {tool.description}
              </p>
            </div>
            <Badge variant={tool.available ? "secondary" : "outline"}>
              {tool.available ? "available" : "unavailable"}
            </Badge>
          </div>
          {renderRun({ toolName: tool.name })}
          <Json value={tool.inputSchema} aria-label="Input schema" />
        </div>
      );
    },
  };
}
