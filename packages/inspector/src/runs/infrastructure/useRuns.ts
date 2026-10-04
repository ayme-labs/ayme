import { useCallback, useRef, useState } from "react";

import type { JsonValue } from "@ayme-dev/ayme";
import { listRegisteredPomTools, runTool } from "@ayme-dev/ayme/internal";

import type { CollectionItem, Run, ToolArguments } from "../domain/run";
import { describeSteps } from "./runSteps";
import { getInspectorTrace, resetInspectorTrace } from "./trace";

/** Tool invocations from the Inspector, newest first. */
export function useRuns({ onSettled }: { onSettled: () => void }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const nextId = useRef(1);

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
        await settle({
          status: "failed",
          // A tool's failure result already reads as an agent gets it.
          error:
            error instanceof ToolFailure ? error.message : errorText(error),
        });
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

/**
 * A failure as an agent gets it: the error's message, prefixed with its name
 * unless that is plain "Error".
 */
function errorText(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  if (!error.name || error.name === "Error") return error.message;
  return `${error.name}: ${error.message}`;
}

/** A tool's failure, with the text an agent gets for it. */
class ToolFailure extends Error {}

type FoundTool = {
  execute: (input: ToolArguments) => Promise<JsonValue>;
  /** The Page Object Model and Page Object a Page Object tool runs on. */
  target?: { className: string; objectPath: string };
};

/**
 * The tool to run by name. Every tool runs the way an agent's call runs,
 * whether or not WebMCP publication is active: a failure comes back as the
 * text an agent gets.
 */
function findTool(toolName: string): FoundTool {
  // Tool names can collide across registrations; this is the one that is
  // live now, the one the runtime runs.
  const pomTool = listRegisteredPomTools().find(
    (candidate) => candidate.name === toolName
  );
  return {
    execute: async (input) => {
      const result = await runTool(toolName, input);
      if (isErrorResult(result))
        throw new ToolFailure(
          result.content.map((part) => part.text).join("\n")
        );
      return result as JsonValue;
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

/** An MCP tool-failure result, which a tool call returns for a failure. */
function isErrorResult(
  result: unknown
): result is { isError: true; content: { text: string }[] } {
  return (
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    result.isError === true &&
    "content" in result &&
    Array.isArray(result.content)
  );
}
