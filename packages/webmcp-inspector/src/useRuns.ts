import { useCallback, useRef, useState } from "react";

import type { JsonValue } from "@ayme-dev/webmcp";
import { listRegisteredPomTools } from "@ayme-dev/webmcp/internal";

import type { ToolArguments } from "./toolArguments";
import {
  getInspectorTrace,
  resetInspectorTrace,
  type TraceEntry,
} from "./trace";
import { errorMessage } from "./useInspector";

export type Run = {
  id: number;
  toolName: string;
  pomId: string;
  arguments: ToolArguments;
  status: "running" | "succeeded" | "failed";
  result?: JsonValue;
  error?: string;
  durationMs?: number;
  trace: readonly TraceEntry[];
};

/** Tool invocations from the Inspector, newest first. */
export function useRuns({ onSettled }: { onSettled: () => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const nextId = useRef(1);

  const invoke = useCallback(
    async (toolName: string, args: ToolArguments) => {
      // Tool names can collide across registrations; call the one that is
      // active now, as WebMCP would.
      const tool = listRegisteredPomTools().find(
        (candidate) => candidate.name === toolName
      );
      if (!tool) return;

      const id = nextId.current++;
      const startedAt = Date.now();
      const settle = (patch: Pick<Run, "status" | "result" | "error">) => {
        const settled = {
          ...patch,
          durationMs: Date.now() - startedAt,
          trace: getInspectorTrace(),
        };
        setRuns((current) =>
          current.map((run) => (run.id === id ? { ...run, ...settled } : run))
        );
      };

      resetInspectorTrace();
      setRuns((current) => [
        {
          id,
          toolName: tool.name,
          pomId: tool.pomId,
          arguments: args,
          status: "running",
          trace: [],
        },
        ...current,
      ]);
      try {
        settle({ status: "succeeded", result: await tool.execute(args) });
      } catch (error) {
        settle({ status: "failed", error: errorMessage(error) });
      } finally {
        onSettled();
      }
    },
    [onSettled]
  );

  const clear = useCallback(() => {
    setRuns([]);
    resetInspectorTrace();
  }, []);

  return { runs, invoke, clear };
}
