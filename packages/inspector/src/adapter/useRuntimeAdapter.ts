import { useCallback, useEffect, useMemo, useRef } from "react";

import { getPomDefinitionText } from "@ayme-dev/ayme/internal";

import { useLiveTools } from "./liveTools";
import {
  indexMembers,
  type MemberIndex,
} from "../page-model/domain/memberIndex";
import { buildPageModel } from "../page-model/domain/pageModel";
import {
  pickPromptOf,
  refFilterOf,
  startRefPicking,
  type RefPickingHandlers,
} from "./refPicking";
import { listRunnableTools } from "./runnableTools";
import {
  buildStructureTree,
  emptyStructure,
} from "../structure/domain/structure";
import { useInspector } from "../shared/infrastructure/useInspector";
import { useRuns } from "./useRuns";

/**
 * The runtime adapter: the one place the Inspector reads @ayme-dev/ayme and runs
 * tools. Everything below it takes plain props, so a change to the runtime's
 * API only touches this folder.
 */
export function useRuntimeAdapter({
  structureVisible = false,
}: {
  /** Whether the Structure view shows, so the page state is kept live. */
  structureVisible?: boolean;
} = {}) {
  // Highlights resolve paths as they show, against the latest page model.
  const latestMembers = useRef<MemberIndex>(undefined);
  const targetsOf = useCallback(
    (path: string) => latestMembers.current?.targets(path) ?? new Set<string>(),
    []
  );
  const inspector = useInspector({ structureVisible, targetsOf });
  const { registeredPoms, activeTools, pomDefinitions, refreshPageState } =
    inspector;
  const onRunSettled = useCallback(
    () => refreshPageState(),
    [refreshPageState]
  );
  const { runs, invoke, clear } = useRuns({ onSettled: onRunSettled });
  const tools = useLiveTools();

  const { projected, targetsByRef, controls, ...pageState } =
    inspector.pageState;
  const { elementsByRef, elementToolTargets } = pageState;
  const pageModel = useMemo(
    () =>
      buildPageModel(
        registeredPoms,
        new Set(tools.live.map((tool) => tool.name)),
        pomDefinitions
      ),
    [registeredPoms, tools.live, pomDefinitions]
  );
  const members = useMemo(() => indexMembers(pageModel), [pageModel]);
  useEffect(() => {
    latestMembers.current = members;
  }, [members]);
  const structure = useMemo(
    () =>
      projected === undefined
        ? emptyStructure
        : buildStructureTree(projected, targetsByRef, members, controls),
    [projected, targetsByRef, members, controls]
  );
  const elementTools = useMemo(
    () =>
      tools.live
        .filter((tool) => elementToolTargets.has(tool.name))
        .map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
          refs: elementToolTargets.get(name) ?? [],
        })),
    [tools.live, elementToolTargets]
  );
  const runnableTools = useMemo(
    () => listRunnableTools(registeredPoms, activeTools, tools.live),
    [registeredPoms, activeTools, tools.live]
  );

  // Picking reads the latest look at the page as the pointer moves.
  const refByElement = useRef(new Map<Element, string>());
  useEffect(() => {
    refByElement.current = uniqueRefs(elementsByRef);
  }, [elementsByRef]);
  const { hover } = inspector.highlight;

  return {
    /** The page's name for the header badge: its page Page Object's class. */
    pageName: registeredPoms[0]?.manifest.className,
    /** The Page Objects on the page and the Page Object Models it knows. */
    pageModel,
    /**
     * The page model by member path: what a member or group path stands
     * for, and the items a collection action runs on.
     */
    members,
    /**
     * The tools the panel can run now: `tools.live`, every live tool in
     * publication order, published or not;
     * and `tools.publication`, the WebMCP publication status (a failure
     * carries its error in `message`).
     */
    tools,
    /**
     * The POM definitions for `names` (every known one when none are given),
     * as `snapshot` renders them. Captures no page state.
     */
    definitionText: (...names: string[]) => getPomDefinitionText(...names),
    /**
     * The page state as an agent would receive it, kept live without ever
     * being recorded: the structure tree model, and the refs each
     * published single-element tool can take (`pageState.elementToolTargets`).
     */
    pageState: { ...pageState, structure },
    /**
     * The page's two highlights: `hover` (dashed) for what the pointer is
     * over in the panel, `pin` (solid) for the selection. The app pins the
     * selection; lenses only hover.
     */
    highlight: inspector.highlight,
    /**
     * Every registered Page Object tool once by name, and every other live
     * tool, as the run card runs them.
     */
    runnableTools,
    /**
     * The live single-element tools, published or not, each with the refs it can take
     * now.
     */
    elementTools,
    /** The runs made from the panel, newest first. */
    runs,
    runTool: (...args: Parameters<typeof invoke>) => void invoke(...args),
    clearRuns: clear,
    /** Choosing a ref for a tool's ref field. */
    refPicking: {
      /**
       * Which nodes a tool can use, by the tool's name: the refs it can take
       * in the page state, or every node when the runtime lists none for it.
       */
      canUse: (toolName: string) => refFilterOf(elementToolTargets, toolName),
      /** What picking with a tool asks the person to click, by its name. */
      promptOf: pickPromptOf,
      /** Picks a ref by pointing at the page, from the latest look at it. */
      start: (handlers: RefPickingHandlers) => {
        // Look at the page again, in case it changed unseen since the last look.
        refreshPageState();
        return startRefPicking({
          ...handlers,
          refOf: (element) => refByElement.current.get(element),
          hover: (ref) => hover(ref === undefined ? undefined : { ref }),
        });
      },
    },
  };
}

export type InspectorRuntime = ReturnType<typeof useRuntimeAdapter>;

/** Each element's ref, for the elements that have exactly one. */
function uniqueRefs(elementsByRef: ReadonlyMap<string, Element>) {
  const refs = new Map<Element, string | undefined>();
  for (const [ref, element] of elementsByRef)
    refs.set(element, refs.has(element) ? undefined : ref);
  return new Map(
    [...refs].filter(
      (entry): entry is [Element, string] => entry[1] !== undefined
    )
  );
}
