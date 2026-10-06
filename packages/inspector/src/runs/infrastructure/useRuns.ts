import { useCallback, useRef } from "react";

import { RuntimeStateError, type JsonValue } from "@ayme-dev/ayme";
import {
  getStartedAyme,
  listRegisteredPomTools,
} from "@ayme-dev/ayme/internal";

import { useTabState } from "../../shared";
import type { CollectionItem, Run, ToolArguments } from "../domain/run";
import { decodeRuns, encodeRuns, runsKey } from "../domain/storedRuns";
import { describeSteps } from "./runSteps";
import { getInspectorTrace, resetInspectorTrace } from "./trace";

/**
 * Tool invocations from the Inspector, newest first. The newest are kept for
 * the tab, so a reload still shows them.
 */
export function useRuns({ onSettled }: { onSettled: () => void }) {
  const [runs, setRuns] = useTabState(runsKey, decodeRuns, encodeRuns);
  const nextId = useRef(
    runs.reduce((newest, run) => Math.max(newest, run.id), 0) + 1
  );

  const invoke = useCallback(
    async (toolName: string, args: ToolArguments, item?: CollectionItem) => {
      const tool = findTool(toolName);
      const id = nextId.current++;
      const startedAt = Date.now();
      const settle = async (
        patch: Pick<Run, "status" | "result" | "error">
      ) => {
        const durationMs = Date.now() - startedAt;
        const settled = {
          ...patch,
          durationMs,
          steps: await describeSteps(getInspectorTrace()),
        };
        setRuns((current) =>
          current.map((run) => (run.id === id ? { ...run, ...settled } : run))
        );
      };

      // The trace holds one run's steps: it's reset as each run starts.
      resetInspectorTrace();
      setRuns((current) => [
        {
          id,
          toolName,
          ...tool.target,
          ...(item ? { item, objectPath: item.path } : {}),
          arguments: args,
          status: "running",
          startedAt,
          steps: [],
        },
        ...current,
      ]);
      try {
        const result = JSON.stringify(await tool.execute(args), null, 2) as
          string | undefined;
        await settle({ status: "succeeded", result });
      } catch (error) {
        await settle({ status: "failed", error: errorText(error) });
      } finally {
        onSettled();
      }
    },
    [onSettled, setRuns]
  );

  const clear = useCallback(() => {
    setRuns([]);
    resetInspectorTrace();
  }, [setRuns]);

  return { runs, invoke, clear };
}

/**
 * A failure as an agent gets it: the error's message, prefixed with its name
 * unless that is plain "Error".
 */
function errorText(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  if (!error.name || error.name === "Error") return error.message;
  return `${error.name}: ${error.message}`;
}

type FoundTool = {
  execute: (input: ToolArguments) => Promise<JsonValue>;
  /** The Page Object Model and Page Object a Page Object tool runs on. */
  target?: { className: string; objectPath: string };
};

/**
 * The tool to run by name. Every tool runs through the started session,
 * whether or not WebMCP publication is active, and fails with the error an
 * agent gets as text.
 */
function findTool(toolName: string): FoundTool {
  // Tool names can collide across registrations; this is the one that is
  // live now, the one the runtime runs.
  const pomTool = listRegisteredPomTools().find(
    (candidate) => candidate.name === toolName
  );
  return {
    execute: async (input) => {
      const ayme = getStartedAyme();
      if (!ayme)
        throw new RuntimeStateError("No Ayme runtime session has started.");
      return (await ayme.tools.run(toolName, input)) as JsonValue;
    },
    ...(pomTool
      ? {
          target: {
            className: pomTool.componentClassName ?? pomTool.pomId,
            objectPath:
              pomTool.componentPath === undefined
                ? pomTool.pomId
                : `${pomTool.pomId}.${pomTool.componentPath}`,
          },
        }
      : {}),
  };
}
