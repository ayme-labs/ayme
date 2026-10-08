import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { callers, type Ayme, type Run as LogRun } from "@ayme-dev/ayme";
import {
  getAppProcessTools,
  getStartedAyme,
  listAvailablePomTools,
  subscribeToAgentImageRuns,
  subscribeToStartedAyme,
} from "@ayme-dev/ayme/internal";

import { useTabState } from "../../shared";
import {
  rowIdOf,
  shownRuns,
  type RunNotes,
  type RunTarget,
} from "../domain/logRuns";
import type { CollectionItem, ToolArguments } from "../domain/run";
import { decodeRuns, encodeRuns, runsKey } from "../domain/storedRuns";
import { interactionMembers } from "./interactionMembers";

/** The key of when Runs was last cleared in the tab's storage. */
const clearedKey = "ayme-inspector:runs-cleared";

const NO_RUNS: readonly LogRun[] = Object.freeze([]);
const NO_NOTES: ReadonlyMap<string, RunNotes> = new Map();

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
 * Caller's Runs with the Runs they started nested under them, each on the
 * collection item its ref named when it started, and each Run's
 * Interactions, named by the member they acted on once it ends. An image a
 * Run returned, such as a screenshot, shows as itself, with the file
 * `ayme mcp` saved it to for an agent's. The rows shown are kept for the
 * tab, so a reload still shows them, as earlier page rows. `invoke` runs a
 * tool as the Inspector.
 */
export function useRuns({
  onSettled,
  itemOf,
}: {
  onSettled: () => void;
  /** The item of the collection tool `toolName` whose root is `ref` now. */
  itemOf: (toolName: string, ref: string) => CollectionItem | undefined;
}) {
  const [stored, setStored] = useTabState(runsKey, decodeRuns, encodeRuns);
  // The rows kept from before the panel mounted, read once.
  const [earlier, setEarlier] = useState(stored);
  const [clearedAt, setClearedAt] = useTabState(clearedKey, decodeTime);
  const [log, setLog] = useState<{
    runs: readonly LogRun[];
    notes: ReadonlyMap<string, RunNotes>;
  }>({ runs: NO_RUNS, notes: NO_NOTES });
  const pending = useRef<PendingRun[]>([]);

  useEffect(() => {
    const note = (rowId: string, notes: RunNotes) => {
      // A Run the log dropped meanwhile keeps no notes.
      if (!seen.has(rowId)) return;
      setLog((current) => ({
        ...current,
        notes: new Map(current.notes).set(rowId, {
          ...current.notes.get(rowId),
          ...notes,
        }),
      }));
    };

    /**
     * The item a new Run is on: a run of the panel's has the item it was
     * started on; any other, the item its `ref` names on the page now.
     */
    const itemOfNewRun = (run: LogRun, rowId: string): RunNotes => {
      const panelRun =
        run.by === callers.inspector && run.status === "running"
          ? pending.current.find(
              (candidate) =>
                candidate.rowId === undefined &&
                candidate.toolName === run.tool &&
                candidate.input === JSON.stringify(run.input)
            )
          : undefined;
      if (panelRun) panelRun.rowId = rowId;
      const ref = (run.input as { ref?: unknown } | undefined)?.ref;
      const item =
        panelRun?.item ??
        (typeof ref === "string" ? itemOf(run.tool, ref) : undefined);
      return item ? { item } : {};
    };

    // The Runs seen so far, the ended Runs whose Interactions have been
    // named, and the agent's image Runs whose file has been noted, by row id.
    const seen = new Set<string>();
    const described = new Set<string>();
    const saved = new Set<string>();
    let listedRuns = NO_RUNS;
    const read = (runs: readonly LogRun[]) => {
      listedRuns = runs;
      const listed = new Set(runs.map(rowIdOf));
      // What the panel knows of a Run goes when the log drops the Run.
      for (const ids of [seen, described, saved])
        for (const rowId of ids) if (!listed.has(rowId)) ids.delete(rowId);
      const fresh = new Map<string, RunNotes>();
      for (const run of runs) {
        const rowId = rowIdOf(run);
        if (seen.has(rowId)) continue;
        seen.add(rowId);
        fresh.set(rowId, {
          ...targetOf(run.tool),
          ...itemOfNewRun(run, rowId),
        });
      }
      setLog((current) => {
        const notes = new Map(
          [...current.notes].filter(([rowId]) => listed.has(rowId))
        );
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
    // `ayme mcp` reports the file it saves an image to after the Run ended,
    // so the log already lists it: the newest such Run with no file yet.
    const unsubscribeFromImages = subscribeToAgentImageRuns(
      ({ name, input, savedTo }) => {
        if (savedTo === undefined) return;
        const json = JSON.stringify(input);
        const run = listedRuns.findLast(
          (candidate) =>
            candidate.by === callers.aymeMcp &&
            candidate.tool === name &&
            candidate.status === "succeeded" &&
            !saved.has(rowIdOf(candidate)) &&
            JSON.stringify(candidate.input) === json
        );
        if (!run) return;
        saved.add(rowIdOf(run));
        note(rowIdOf(run), { savedTo });
      }
    );
    return () => {
      unsubscribeFromStarted();
      unsubscribeFromLog();
      unsubscribeFromImages();
    };
  }, [itemOf]);

  const runs = useMemo(
    () =>
      shownRuns({
        log: log.runs,
        notes: log.notes,
        earlier,
        clearedAt,
      }),
    [log, earlier, clearedAt]
  );
  useEffect(() => setStored(runs), [runs, setStored]);

  const invoke = useCallback(
    async (toolName: string, args: ToolArguments, item?: CollectionItem) => {
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
        if (appProcess) await appProcessTools!.run(toolName, args, by);
        else await ayme?.tools.run(toolName, args as never, by);
      } catch {
        // The log records the failed Run, which the panel shows.
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
  }, [setClearedAt]);

  return { runs, invoke, clear };
}

/** When Runs was last cleared, from its stored value; never by default. */
function decodeTime(stored: unknown): number {
  return typeof stored === "number" ? stored : 0;
}

/**
 * The Page Object Model and Page Object a Page Object tool runs on, from
 * the registry as it is now. Tool names can collide across registrations;
 * this is the one that is available now, the one the runtime runs.
 */
function targetOf(toolName: string): { target?: RunTarget } {
  const pomTool = listAvailablePomTools().find(
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
