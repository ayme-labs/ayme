import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  callers,
  RuntimeStateError,
  type Ayme,
  type Run as LogRun,
} from "@ayme-dev/ayme";
import {
  getAppProcessTools,
  getStartedAyme,
  listRegisteredPomTools,
  subscribeToStartedAyme,
} from "@ayme-dev/ayme/internal";

import { useTabState } from "../../shared";
import {
  rowIdOf,
  shownRuns,
  type RunNotes,
  type RunTarget,
} from "../domain/logRuns";
import type { CollectionItem, Run, ToolArguments } from "../domain/run";
import { decodeRuns, encodeRuns, runsKey } from "../domain/storedRuns";
import { interactionMembers } from "./interactionMembers";

/** The key of when Runs was last cleared in the tab's storage. */
const clearedKey = "ayme-inspector:runs-cleared";

const NO_RUNS: readonly LogRun[] = Object.freeze([]);
const NO_NOTES: ReadonlyMap<string, RunNotes> = new Map();

// Numbers the panel's runs the log never listed.
let nextUnlogged = 1;

/** A run the panel started and the log has not listed yet. */
type PendingRun = {
  toolName: string;
  /** Its input as JSON, which tells it from another run of the tool. */
  input: string;
  item?: CollectionItem;
  /** The log Run it became, by row id, once listed. */
  rowId?: string;
};

/**
 * Runs as the panel shows them, newest first: the page's Run log, every
 * Caller's Runs with the Runs they started nested under them, and each
 * Run's Interactions, named by the member they acted on once it ends. The
 * rows shown are kept for the tab, so a reload still shows them, as earlier
 * page rows. `invoke` runs a tool as the Inspector.
 */
export function useRuns({ onSettled }: { onSettled: () => void }) {
  const [stored, setStored] = useTabState(runsKey, decodeRuns, encodeRuns);
  // The rows kept from before the panel mounted, read once.
  const [earlier, setEarlier] = useState(stored);
  const [clearedAt, setClearedAt] = useTabState(clearedKey, decodeTime);
  const [log, setLog] = useState<{
    runs: readonly LogRun[];
    notes: ReadonlyMap<string, RunNotes>;
  }>({ runs: NO_RUNS, notes: NO_NOTES });
  const [unlogged, setUnlogged] = useState<readonly Run[]>([]);
  const pending = useRef<PendingRun[]>([]);

  useEffect(() => {
    const note = (rowId: string, notes: RunNotes) =>
      setLog((current) => ({
        ...current,
        notes: new Map(current.notes).set(rowId, {
          ...current.notes.get(rowId),
          ...notes,
        }),
      }));

    /** A new Run of the panel's is claimed by the run that started it. */
    const noteNewRun = (run: LogRun, rowId: string): RunNotes => {
      if (run.by !== callers.inspector || run.status !== "running") return {};
      const input = JSON.stringify(run.input);
      const panelRun = pending.current.find(
        (candidate) =>
          candidate.rowId === undefined &&
          candidate.toolName === run.tool &&
          candidate.input === input
      );
      if (!panelRun) return {};
      panelRun.rowId = rowId;
      return panelRun.item ? { item: panelRun.item } : {};
    };

    // The Runs seen so far, and the ended Runs whose Interactions have
    // been named, by row id.
    const seen = new Set<string>();
    const described = new Set<string>();
    const read = (runs: readonly LogRun[]) => {
      const fresh = new Map<string, RunNotes>();
      for (const run of runs) {
        const rowId = rowIdOf(run);
        if (seen.has(rowId)) continue;
        seen.add(rowId);
        fresh.set(rowId, { ...targetOf(run.tool), ...noteNewRun(run, rowId) });
      }
      setLog((current) => {
        if (!fresh.size) return { ...current, runs };
        const notes = new Map(current.notes);
        for (const [rowId, runNotes] of fresh)
          notes.set(rowId, { ...notes.get(rowId), ...runNotes });
        return { runs, notes };
      });
      for (const run of runs) {
        const rowId = rowIdOf(run);
        if (run.status === "running" || described.has(rowId)) continue;
        described.add(rowId);
        if (!run.interactions.length) continue;
        void interactionMembers(run.interactions).then((members) =>
          note(rowId, { members })
        );
      }
    };

    let unsubscribeFromLog = () => {};
    const follow = (ayme: Ayme | undefined) => {
      unsubscribeFromLog();
      unsubscribeFromLog = ayme?.runs.subscribe(read) ?? (() => {});
      read(ayme?.runs.list() ?? NO_RUNS);
    };
    const unsubscribeFromStarted = subscribeToStartedAyme(follow);
    follow(getStartedAyme());
    return () => {
      unsubscribeFromStarted();
      unsubscribeFromLog();
    };
  }, []);

  const runs = useMemo(
    () =>
      shownRuns({
        log: log.runs,
        notes: log.notes,
        unlogged,
        earlier,
        clearedAt,
      }),
    [log, unlogged, earlier, clearedAt]
  );
  useEffect(() => setStored(runs), [runs, setStored]);

  const invoke = useCallback(
    async (toolName: string, args: ToolArguments, item?: CollectionItem) => {
      const startedAt = Date.now();
      const ayme = getStartedAyme();
      const appProcessTools = ayme && getAppProcessTools(ayme);
      const appProcess =
        appProcessTools?.list().some(({ name }) => name === toolName) ?? false;
      const panelRun: PendingRun = {
        toolName,
        input: JSON.stringify(args),
        ...(item ? { item } : {}),
      };
      pending.current.push(panelRun);
      const by = { by: callers.inspector };
      try {
        if (!ayme)
          throw new RuntimeStateError("No Ayme runtime session has started.");
        if (appProcess) await appProcessTools!.run(toolName, args, by);
        else await ayme.tools.run(toolName, args as never, by);
      } catch (error) {
        // A run the log never listed, such as one whose tool is no longer
        // live, still shows its failure.
        if (panelRun.rowId === undefined)
          setUnlogged((current) => [
            {
              id: `panel-${nextUnlogged++}@${startedAt}`,
              toolName,
              by: callers.inspector,
              ...targetOf(toolName).target,
              ...(item ? { item, objectPath: item.path } : {}),
              arguments: args,
              status: "failed",
              error: errorText(error),
              startedAt,
              durationMs: Date.now() - startedAt,
              interactions: [],
              children: [],
            },
            ...current,
          ]);
      } finally {
        pending.current.splice(pending.current.indexOf(panelRun), 1);
        onSettled();
      }
    },
    [onSettled]
  );

  const clear = useCallback(() => {
    setClearedAt(Date.now());
    setEarlier([]);
    setUnlogged([]);
  }, [setClearedAt]);

  return { runs, invoke, clear };
}

/** When Runs was last cleared, from its stored value; never by default. */
function decodeTime(stored: unknown): number {
  return typeof stored === "number" ? stored : 0;
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

/**
 * The Page Object Model and Page Object a Page Object tool runs on, from
 * the registry as it is now. Tool names can collide across registrations;
 * this is the one that is live now, the one the runtime runs.
 */
function targetOf(toolName: string): { target?: RunTarget } {
  const pomTool = listRegisteredPomTools().find(
    (candidate) => candidate.name === toolName
  );
  if (!pomTool) return {};
  return {
    target: {
      className: pomTool.componentClassName ?? pomTool.pomId,
      objectPath:
        pomTool.componentPath === undefined
          ? pomTool.pomId
          : `${pomTool.pomId}.${pomTool.componentPath}`,
    },
  };
}
