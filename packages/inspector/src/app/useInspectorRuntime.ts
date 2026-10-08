import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  listRunnableTools,
  pickPromptOf,
  pomDefinitionText,
  refFilterOf,
  type RefPickingHandlers,
  startRefPicking,
  useLiveTools,
} from "../tools";
import { buildPageModel, indexMembers, type MemberIndex } from "../page-model";
import { buildStructureTree, emptyStructure } from "../structure";
import { useHighlights } from "../navigation";
import { usePageLook } from "../shared";
import { useRuns } from "../runs";
import { itemsOf } from "./collectionItems";

/**
 * What the Inspector shows and does, composed from each slice's own reading
 * of the runtime and the page: the page look, the page model, the structure,
 * the live tools, the runs and the highlights. Components below the app take
 * plain props.
 */
export function useInspectorRuntime({
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
  const highlight = useHighlights({ targetsOf });
  const inspector = usePageLook({
    structureVisible,
    onLook: highlight.onLook,
  });
  const { registeredPoms, activeTools, pomDefinitions, refreshPageState } =
    inspector;
  const onRunSettled = useCallback(
    () => refreshPageState(),
    [refreshPageState]
  );
  // A Run's item is the one its ref names in the latest look at the page.
  const latestStructure = useRef(emptyStructure);
  const itemOf = useCallback(
    (toolName: string, ref: string) =>
      latestMembers.current &&
      itemsOf(toolName, latestMembers.current, latestStructure.current).find(
        (item) => item.ref === ref
      ),
    []
  );
  const { runs, invoke, clear } = useRuns({
    onSettled: onRunSettled,
    itemOf,
  });
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
  useEffect(() => {
    latestStructure.current = structure;
  }, [structure]);
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
    () =>
      listRunnableTools(registeredPoms, activeTools, [
        ...tools.live,
        ...tools.appProcess,
      ]),
    [registeredPoms, activeTools, tools.live, tools.appProcess]
  );

  // Picking reads the latest look at the page as the pointer moves.
  const refByElement = useRef(new Map<Element, string>());
  useEffect(() => {
    refByElement.current = uniqueRefs(elementsByRef);
  }, [elementsByRef]);
  const { hover, pin } = highlight;

  return {
    /** The Page Objects on the page and the Page Object Models it knows. */
    pageModel,
    /**
     * The page model by member path: what a member or group path stands
     * for, and the items a collection action runs on.
     */
    members,
    /**
     * The tools the panel can run now: `tools.live`, every live tool in
     * publication order, published or not; `tools.appProcess`, the tools of
     * the App Processes paired beside the page, run through the agent's
     * Ayme MCP server;
     * and `tools.publication`, the WebMCP publication status (a failure
     * carries its error in `message`).
     */
    tools,
    /**
     * The POM definitions for `names` (every known one when none are given),
     * as `snapshot` renders them. Captures no page state.
     */
    definitionText: pomDefinitionText,
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
    highlight: { hover, pin },
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

export type InspectorRuntime = ReturnType<typeof useInspectorRuntime>;

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
