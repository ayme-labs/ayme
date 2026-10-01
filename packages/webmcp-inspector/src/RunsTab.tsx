import { Button } from "@ayme-dev/design-system/components/button";

import { Empty, Json, RunStatus, Section } from "./common";
import type { TraceEntry } from "./trace";
import type { Run } from "./useRuns";

export function RunsTab({
  runs,
  clearRuns,
  trace,
}: {
  runs: readonly Run[];
  clearRuns: () => void;
  trace: readonly TraceEntry[];
}) {
  return (
    <div className="grid gap-4">
      <Section
        title="Recent executions"
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={!runs.length}
            onClick={clearRuns}
          >
            Clear
          </Button>
        }
      >
        {runs.length ? (
          <ol className="grid gap-2">
            {runs.map((run) => (
              <li
                key={run.id}
                className="grid gap-1 rounded-md border p-2"
                data-run-id={run.id}
                data-run-tool={run.toolName}
              >
                <div className="flex items-center gap-2 text-xs">
                  <code className="font-mono font-semibold break-all">
                    {run.toolName}
                  </code>
                  <RunStatus run={run} />
                  {run.durationMs !== undefined && (
                    <span className="text-muted-foreground">
                      {run.durationMs} ms
                    </span>
                  )}
                </div>
                <Json
                  value={{
                    arguments: run.arguments,
                    result: run.result,
                    error: run.error,
                    trace: run.trace,
                  }}
                />
              </li>
            ))}
          </ol>
        ) : (
          <Empty>Invoke a tool to see its execution here.</Empty>
        )}
      </Section>

      <Section title="Latest browser trace">
        {trace.length ? (
          <Json value={trace} />
        ) : (
          <Empty>No browser POM operations yet.</Empty>
        )}
      </Section>
    </div>
  );
}
