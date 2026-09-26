import type { KeyboardEvent } from "react";

import type { PomMemberManifest, RegisteredPomTool } from "@ayme-dev/webmcp";
import { Badge } from "@ayme-dev/design-system/components/badge";
import { cn } from "@ayme-dev/design-system/lib/utils";

import { Empty } from "./common";
import {
  memberHighlightPath,
  memberKindLabel,
  memberState,
  memberSummary,
  type MemberState,
  type PomClass,
} from "./pomModel";
import type { FieldValue, FieldValues, ToolArguments } from "./toolArguments";
import { ToolForm } from "./ToolForm";
import type { Run } from "./useRuns";

const memberStateVariant = {
  present: "secondary",
  absent: "outline",
  pending: "outline",
  ambiguous: "default",
  "probe failed": "destructive",
} as const satisfies Record<MemberState, string>;

export type HighlightControls = {
  pinnedPath: string | undefined;
  previewTarget: (path: string) => void;
  clearPreview: () => void;
  togglePinnedTarget: (path: string) => void;
};

export type ToolControls = {
  activeTools: ReadonlyMap<string, RegisteredPomTool>;
  formValues: Readonly<Record<string, FieldValues>>;
  setFieldValue: (
    toolName: string,
    parameterName: string,
    value: FieldValue
  ) => void;
  invoke: (toolName: string, args: ToolArguments) => void;
  lastRunByTool: ReadonlyMap<string, Run>;
};

export function PageObjectsTab({
  pomClasses,
  highlight,
  tools,
}: {
  pomClasses: readonly PomClass[];
  highlight: HighlightControls;
  tools: ToolControls;
}) {
  if (!pomClasses.length) return <Empty>No POM classes are recognized.</Empty>;

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        Hover a member to highlight its elements on the page; click to pin the
        highlight.
      </p>
      {pomClasses.map((pomClass) => (
        <article
          key={pomClass.className}
          className="grid gap-2 rounded-lg border p-3"
          data-pom-class={pomClass.className}
          data-pom-id={pomClass.className}
        >
          <header className="flex items-center justify-between gap-2">
            <code className="font-mono text-sm font-semibold break-all">
              {pomClass.className}
            </code>
            <Badge variant="outline">
              {pomClass.kind === "page" ? "Page POM" : "Component POM"}
            </Badge>
          </header>

          <h4 className="text-xs font-medium text-muted-foreground uppercase">
            Members ({pomClass.members.length})
          </h4>
          {pomClass.members.length ? (
            <div className="grid gap-1">
              {pomClass.members.map((member) => (
                <MemberRow
                  key={member.memberName}
                  pomClass={pomClass}
                  member={member}
                  highlight={highlight}
                />
              ))}
            </div>
          ) : (
            <Empty>This POM has no inspectable members.</Empty>
          )}

          <h4 className="text-xs font-medium text-muted-foreground uppercase">
            Tools ({pomClass.tools.length})
          </h4>
          {pomClass.tools.length ? (
            pomClass.tools.map((tool) => (
              <ToolForm
                key={tool.name}
                tool={tool}
                available={tools.activeTools.has(tool.name)}
                values={tools.formValues[tool.name]}
                onChange={(parameterName, value) =>
                  tools.setFieldValue(tool.name, parameterName, value)
                }
                onInvoke={(args) => tools.invoke(tool.name, args)}
                lastRun={tools.lastRunByTool.get(tool.name)}
              />
            ))
          ) : (
            <Empty>This POM has no registered tools.</Empty>
          )}
        </article>
      ))}
    </div>
  );
}

function MemberRow({
  pomClass,
  member,
  highlight,
}: {
  pomClass: PomClass;
  member: PomMemberManifest;
  highlight: HighlightControls;
}) {
  const path = memberHighlightPath(pomClass, member);
  const pinned = highlight.pinnedPath === path;
  const state = memberState(pomClass, member);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    highlight.togglePinnedTarget(path);
  };

  return (
    <div
      className={cn(
        "grid cursor-crosshair gap-0.5 rounded-md border p-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
        pinned && "border-primary bg-accent"
      )}
      data-member-name={member.memberName}
      data-highlight-path={path}
      role="button"
      tabIndex={0}
      aria-pressed={pinned}
      onMouseEnter={() => highlight.previewTarget(path)}
      onMouseLeave={highlight.clearPreview}
      onFocus={() => highlight.previewTarget(path)}
      onBlur={highlight.clearPreview}
      onClick={() => highlight.togglePinnedTarget(path)}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-xs break-all">{member.memberName}</code>
        <Badge variant={memberStateVariant[state]} data-member-state={state}>
          {state}
        </Badge>
      </div>
      <span className="text-xs text-muted-foreground">
        {memberKindLabel(member)} · {memberSummary(pomClass, member)}
      </span>
    </div>
  );
}
