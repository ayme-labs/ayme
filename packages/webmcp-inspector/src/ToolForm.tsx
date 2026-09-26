import { useId, useState, type FormEvent } from "react";

import type { RegisteredPomTool } from "@ayme-dev/webmcp";
import { Badge } from "@ayme-dev/design-system/components/badge";
import { Button } from "@ayme-dev/design-system/components/button";

import {
  fieldKind,
  fieldValue,
  toolArguments,
  type FieldValue,
  type FieldValues,
  type ToolArguments,
} from "./toolArguments";
import { Json, RunStatus } from "./common";
import type { Run } from "./adapter/useRuns";

const inputClass =
  "w-full min-w-0 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function ToolForm({
  tool,
  available,
  values,
  onChange,
  onInvoke,
  lastRun,
}: {
  tool: RegisteredPomTool;
  available: boolean;
  values: FieldValues | undefined;
  onChange: (parameterName: string, value: FieldValue) => void;
  onInvoke: (args: ToolArguments) => void;
  lastRun: Run | undefined;
}) {
  const id = useId();
  const [error, setError] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = toolArguments(tool, values);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(undefined);
    onInvoke(result.arguments);
  };

  return (
    <form
      className="grid gap-2 rounded-md border p-2"
      data-tool-name={tool.name}
      onSubmit={submit}
    >
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-xs font-semibold break-all">
          {tool.name}
        </code>
        <Badge variant={available ? "secondary" : "outline"}>
          WebMCP {available ? "available" : "unavailable"}
        </Badge>
      </div>
      {tool.description && (
        <p className="text-xs text-muted-foreground">{tool.description}</p>
      )}
      {tool.parameters.map((parameter) => {
        const fieldId = `${id}-${parameter.name}`;
        const value = fieldValue(values, parameter);
        const kind = fieldKind(parameter.schema);
        const label = (
          <label htmlFor={fieldId} className="text-xs font-medium">
            {parameter.name}
            {parameter.optional && " (optional)"}
          </label>
        );
        if (kind === "boolean") {
          return (
            <div key={parameter.name} className="flex items-center gap-2">
              <input
                id={fieldId}
                type="checkbox"
                checked={value === true}
                onChange={(event) =>
                  onChange(parameter.name, event.target.checked)
                }
              />
              {label}
            </div>
          );
        }
        return (
          <div key={parameter.name} className="grid gap-1">
            {label}
            {kind === "enum" ? (
              <select
                id={fieldId}
                className={inputClass}
                value={String(value)}
                onChange={(event) =>
                  onChange(parameter.name, event.target.value)
                }
              >
                {parameter.schema.enum?.map((option, index) => (
                  <option key={index} value={String(index)}>
                    {String(option)}
                  </option>
                ))}
              </select>
            ) : kind === "json" ? (
              <textarea
                id={fieldId}
                className={`${inputClass} font-mono`}
                rows={3}
                value={String(value)}
                onChange={(event) =>
                  onChange(parameter.name, event.target.value)
                }
              />
            ) : (
              <input
                id={fieldId}
                className={inputClass}
                type={kind === "number" ? "number" : "text"}
                value={String(value)}
                onChange={(event) =>
                  onChange(parameter.name, event.target.value)
                }
              />
            )}
          </div>
        );
      })}
      {!tool.parameters.length && (
        <p className="text-xs text-muted-foreground">No arguments required.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={!available}>
          Invoke
        </Button>
      </div>
      {lastRun && (
        <div className="grid gap-1" data-last-run>
          <div className="flex items-center gap-2 text-xs">
            Last result <RunStatus run={lastRun} />
          </div>
          {lastRun.status !== "running" && (
            <Json
              value={
                lastRun.status === "failed" ? lastRun.error : lastRun.result
              }
            />
          )}
        </div>
      )}
    </form>
  );
}
