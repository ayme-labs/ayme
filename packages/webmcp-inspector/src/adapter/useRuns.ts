import { useCallback, useRef, useState } from "react";

import { ayme, type AriaRef, type JsonValue } from "@ayme-dev/webmcp";
import {
  getPageContextTool,
  listRegisteredPomTools,
} from "@ayme-dev/webmcp/internal";

import { getInspectorTrace, resetInspectorTrace } from "../trace";
import { describeSteps, type RunStep } from "./runSteps";

export type ToolArguments = Record<string, JsonValue>;

/** A Page Object in a collection, e.g. ListPage.items[1], with its ref. */
export type CollectionItem = {
  /** Its path from the page, e.g. "ListPage.items[1]". */
  path: string;
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
  result?: JsonValue;
  error?: string;
  /** When it started, in epoch milliseconds. */
  startedAt: number;
  durationMs?: number;
  /** The locator operations it performed, from the Inspector's own trace. */
  steps: readonly RunStep[];
};

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
        if (!tool.execute)
          throw new Error(`The Inspector can't run ${toolName}.`);
        const result = await tool.execute(args);
        await settle({ status: "succeeded", result });
      } catch (error) {
        await settle({ status: "failed", error: errorText(error) });
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

type FoundTool = {
  execute?: (input: ToolArguments) => Promise<JsonValue>;
  /** The Page Object Model and Page Object a Page Object tool runs on. */
  target?: { className: string; objectPath: string };
};

/**
 * The tool to run by name: a Page Object tool, or one of the other tools the
 * runtime lets the Inspector run.
 */
function findTool(toolName: string): FoundTool {
  // Tool names can collide across registrations; call the one that is
  // active now, as WebMCP would.
  const pomTool = listRegisteredPomTools().find(
    (candidate) => candidate.name === toolName
  );
  if (pomTool)
    return {
      execute: async (input) => await pomTool.execute(input),
      target: {
        className: pomTool.componentClassName ?? pomTool.pomId,
        objectPath:
          pomTool.componentPath === undefined
            ? pomTool.pomId
            : `${pomTool.pomId}.${pomTool.componentPath}`,
      },
    };
  return { execute: otherTool(toolName) };
}

/** The tools besides Page Object tools the Inspector can run. */
function otherTool(
  toolName: string
): ((input: ToolArguments) => Promise<JsonValue>) | undefined {
  switch (toolName) {
    case getPageContextTool.name:
      return (input) => getPageContextTool.execute(input);
    case "click_page_state_ref":
      return async (input) =>
        (await ayme.click(input.ref as AriaRef)) as unknown as JsonValue;
    case "fill_page_state_ref":
      return async (input) =>
        (await ayme.fill(
          input.ref as AriaRef,
          input.value as string
        )) as unknown as JsonValue;
  }
}
