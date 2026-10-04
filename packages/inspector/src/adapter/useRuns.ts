import { useCallback, useRef, useState } from "react";

import type { JsonValue } from "@ayme-dev/ayme";
import { listRegisteredPomTools, runTool } from "@ayme-dev/ayme/internal";

import { getInspectorTrace, resetInspectorTrace } from "../trace";
import { describeSteps, type RunStep } from "./runSteps";

export type ToolArguments = Record<string, JsonValue>;

/** A Page Object in a collection, e.g. ListPage.items[1], with its ref. */
export type CollectionItem = {
  /** Its path from the page, e.g. "ListPage.items[1]". */
  path: string;
  /** Its name in its collection, e.g. "[1]". */
  name: string;
  /** Its path below its page, e.g. "items[1]". */
  pathBelowPage: string;
  /** The Structural Ref of its root, which a collection action takes. */
  ref: string;
  /** What it shows, e.g. "Milk". */
  label: string;
};

/** A run made from the panel: one tool call, with the steps it performed. */
export type Run = {
  id: number;
  toolName: string;
  /** The Page Object Model whose action it ran. */
  className?: string;
  /** The Page Object it ran on, e.g. "ListPage" or "ListPage.items[1]". */
  objectPath?: string;
  /** The collection item it ran on. */
  item?: CollectionItem;
  arguments: ToolArguments;
  status: "running" | "succeeded" | "failed";
  /**
   * What the tool returned, as formatted JSON captured as it returned, so a
   * later change to the returned value doesn't change it. Absent when it
   * returned `undefined`.
   */
  result?: string;
  error?: string;
  /** When it started, in epoch milliseconds. */
  startedAt: number;
  durationMs?: number;
  /** The locator operations it performed, from the Inspector's own trace. */
  steps: readonly RunStep[];
};

/**
 * Tool invocations from the Inspector, newest first.
 *
 * @param memberOf the member a registry target is, by the target's path, to
 *   name the member each step acted on.
 */
export function useRuns({
  onSettled,
  memberOf,
}: {
  onSettled: () => void;
  memberOf: (targetPath: string) => string | undefined;
}) {
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
          steps: await describeSteps(getInspectorTrace(), memberOf),
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
    [onSettled, memberOf]
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
