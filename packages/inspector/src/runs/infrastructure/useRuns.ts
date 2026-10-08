import { useCallback, useEffect, useRef } from "react";

import { RuntimeStateError, type JsonValue } from "@ayme-dev/ayme";
import {
  getAppProcessTools,
  getStartedAyme,
  listAvailablePomTools,
  subscribeToAgentImageRuns,
} from "@ayme-dev/ayme/internal";

import { useTabState } from "../../shared";
import type { CollectionItem, Run, ToolArguments } from "../domain/run";
import { runImageOf } from "../domain/runImage";
import { decodeRuns, encodeRuns, runsKey } from "../domain/storedRuns";
import { describeSteps } from "./runSteps";
import { getInspectorTrace, resetInspectorTrace } from "./trace";

/**
 * Tool invocations from the Inspector, and an agent's screenshots through
 * `ayme mcp`, newest first. The newest are kept for the tab, so a reload
 * still shows them.
 */
export function useRuns({ onSettled }: { onSettled: () => void }) {
  const [runs, setRuns] = useTabState(runsKey, decodeRuns, encodeRuns);
  const nextId = useRef(
    runs.reduce((newest, run) => Math.max(newest, run.id), 0) + 1
  );

  useEffect(
    () =>
      subscribeToAgentImageRuns((agentRun) => {
        const image = runImageOf(agentRun.result, agentRun.savedTo);
        if (!image) return;
        const run: Run = {
          id: nextId.current++,
          toolName: agentRun.name,
          caller: "agent",
          arguments: (agentRun.input ?? {}) as ToolArguments,
          status: "succeeded",
          image,
          startedAt: agentRun.startedAt,
          durationMs: agentRun.durationMs,
          steps: [],
        };
        setRuns((current) => [run, ...current]);
      }),
    [setRuns]
  );

  const invoke = useCallback(
    async (toolName: string, args: ToolArguments, item?: CollectionItem) => {
      const tool = findTool(toolName);
      const id = nextId.current++;
      const startedAt = Date.now();
      const settle = async (
        patch: Pick<Run, "status" | "result" | "image" | "error">
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
        const returned = await tool.execute(args);
        // An image shows as itself, never as its base64 JSON.
        const image = runImageOf(returned);
        if (image) await settle({ status: "succeeded", image });
        else
          await settle({
            status: "succeeded",
            result: JSON.stringify(returned, null, 2) as string | undefined,
          });
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
 * agent gets as text. An App Process's tool runs in that process, through
 * the agent's Ayme MCP server the session's page is paired with.
 */
function findTool(toolName: string): FoundTool {
  // Tool names can collide across registrations; this is the one that is
  // live now, the one the runtime runs.
  const pomTool = listAvailablePomTools().find(
    (candidate) => candidate.name === toolName
  );
  return {
    execute: async (input) => {
      const ayme = getStartedAyme();
      if (!ayme)
        throw new RuntimeStateError("No Ayme runtime session has started.");
      const appProcessTools = getAppProcessTools(ayme);
      if (appProcessTools.list().some(({ name }) => name === toolName))
        return (await appProcessTools.run(toolName, input)) as JsonValue;
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
