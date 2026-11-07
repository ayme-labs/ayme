import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ControlState,
  InspectorLook,
  InspectorPageObject,
  InspectorRootedInstance,
  InspectorTarget,
  PomDefinition,
  ProjectedStructuralNodeForest,
} from "@ayme-dev/ayme/inspector";

import {
  inspectorClient,
  type InspectorClient,
  useInspectorState,
} from "./inspectorClient";
import { createRefreshScheduler } from "./refreshScheduler";

export type RegistrySnapshot = {
  /**
   * The registered Page Objects, each tool described as agents read it,
   * on the page or off it.
   */
  registeredPoms: readonly InspectorPageObject[];
  /** The Page Object Model definitions snapshot returns. */
  pomDefinitions: readonly PomDefinition[];
  /**
   * The items each collection tool acts on, by tool name, each with
   * whether the tool would run on it now and why not.
   */
  toolInstances: ReadonlyMap<string, readonly InspectorRootedInstance[]>;
};

export type PageStateView = {
  /** The projected page state: the forest an agent's text is rendered from. */
  projected?: ProjectedStructuralNodeForest;
  /** The registry targets' paths whose element each ref is, by ref. */
  targetsByRef: ReadonlyMap<string, readonly string[]>;
  /**
   * The refs each published single-element tool can take in this page state, by tool
   * name, in tree order: what an agent is offered for that tool's ref.
   */
  elementToolTargets: ReadonlyMap<string, readonly string[]>;
  /** Every Structural Ref of this page state, in tree order. */
  refs: readonly string[];
  /** The native form controls' states, by ref. */
  controls: ReadonlyMap<string, ControlState>;
  /** Each rooted tool's items on the page, by tool name. */
  rootedInstances: ReadonlyMap<string, readonly InspectorRootedInstance[]>;
  capturedAt?: string;
  error?: string;
  loading: boolean;
};

/** While the Structure view shows, how often it looks at the page anyway. */
const STRUCTURE_POLL_MS = 2000;

/**
 * How often an Inspector in a window of its own looks at the page: it hears
 * none of that page's DOM events, so it looks on a timer, and after each
 * change to the Runs.
 */
const EXTERNAL_POLL_MS = 1500;

/**
 * The Inspector's live view of the page. Each refresh takes one unrecorded
 * look at the page state through the Inspector contract (it never enters the
 * interaction history, so agents see exactly what they would without the
 * Inspector), and that one look feeds the member mapping (the structure is
 * built from it), the Ref Tools' targets and, through `onLook`, the
 * highlights. Page changes, input, focus and registry changes schedule
 * refreshes; while the Structure view shows, a slow poll catches the rest.
 */
export function usePageLook({
  structureVisible,
  onLook,
  client = inspectorClient(),
}: {
  /** Whether the Structure view shows, so the page is looked at often. */
  structureVisible: boolean;
  /** Called with each new look, before the page state it gives shows. */
  onLook: (look: Look) => void;
  /** The Inspector's client of the contract; the document's own unless given. */
  client?: InspectorClient;
}) {
  // The registry as the contract states it: it changes only with a Page Object.
  const state = useInspectorState(client);
  const [pageState, setPageState] = useState<PageStateView>({
    targetsByRef: new Map(),
    elementToolTargets: new Map(),
    refs: [],
    controls: new Map(),
    rootedInstances: new Map(),
    loading: false,
  });

  const mounted = useRef(false);
  const lookListener = useRef(onLook);
  useEffect(() => {
    lookListener.current = onLook;
  }, [onLook]);

  const look = useCallback(async () => {
    setPageState((current) => ({ ...current, loading: true }));
    try {
      const next = await lookAtPage(client);
      if (!mounted.current) return;
      lookListener.current(next);
      setPageState({
        projected: next.state.projected,
        targetsByRef: next.targetsByRef,
        elementToolTargets: next.elementToolTargets,
        refs: next.state.refs,
        controls: new Map(Object.entries(next.state.controls)),
        rootedInstances: new Map(Object.entries(next.state.rootedInstances)),
        capturedAt: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        loading: false,
      });
    } catch (error) {
      if (!mounted.current) return;
      setPageState((current) => ({
        ...current,
        error: errorMessage(error),
        loading: false,
      }));
    }
  }, [client]);

  const [scheduler] = useState(() => createRefreshScheduler(() => look()));
  const refreshPageState = useCallback(() => scheduler.request(), [scheduler]);

  // The registry changes, and with it the look: a Page Object registered,
  // unregistered or with new definitions. Also at mount, for the first look.
  useEffect(() => {
    if (mounted.current) scheduler.request();
  }, [state.pageObjects, state.pomDefinitions, scheduler]);
  // An agent's Run changes the page; an Inspector outside it does not hear
  // the page change.
  useEffect(() => {
    if (client.external && mounted.current) scheduler.request();
  }, [client.external, state.runs, scheduler]);

  useEffect(() => {
    mounted.current = true;
    // The page is another document's: its changes are not this one's.
    if (client.external) {
      scheduler.request();
      const poll = setInterval(() => scheduler.request(), EXTERNAL_POLL_MS);
      return () => {
        mounted.current = false;
        clearInterval(poll);
        scheduler.dispose();
      };
    }

    // Changes to the page, except the Inspector's own marks on it.
    const observer = new MutationObserver((records) => {
      if (!records.every(isInspectorOwnMutation)) scheduler.request();
    });
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    // Typing, checking and focus change the page state without mutating the
    // DOM. Events from inside the Inspector reach here from its host.
    const onPageEvent = (event: Event) => {
      if (!isFromInspector(event)) scheduler.request();
    };
    const pageEvents = ["input", "change", "focusin", "focusout"] as const;
    for (const type of pageEvents)
      document.addEventListener(type, onPageEvent, true);

    scheduler.request();

    return () => {
      mounted.current = false;
      observer.disconnect();
      for (const type of pageEvents)
        document.removeEventListener(type, onPageEvent, true);
      scheduler.dispose();
    };
  }, [scheduler, client.external]);

  // Open shadow roots in the app and CSS-only state change nothing the
  // observer or the listeners see; look again now and then while it shows.
  useEffect(() => {
    if (!structureVisible) return;
    const poll = setInterval(() => scheduler.request(), STRUCTURE_POLL_MS);
    return () => clearInterval(poll);
  }, [scheduler, structureVisible]);

  const registry: RegistrySnapshot = {
    registeredPoms: state.pageObjects,
    pomDefinitions: state.pomDefinitions,
    toolInstances: pageState.rootedInstances,
  };
  return { ...registry, pageState, refreshPageState };
}

/** One look at the page, and what the Inspector reads from it. */
export type Look = {
  state: InspectorLook;
  /** The registry's targets, each with its ref when the page state holds its element. */
  targets: readonly InspectorTarget[];
  /** The refs of the page state: only these can be highlighted. */
  refs: ReadonlySet<string>;
  targetsByRef: ReadonlyMap<string, readonly string[]>;
  elementToolTargets: ReadonlyMap<string, readonly string[]>;
};

/** Looks at the page through the contract, and maps each ref to its registry targets. */
async function lookAtPage(client: InspectorClient): Promise<Look> {
  const state = await client.look();
  return {
    state,
    targets: state.targets,
    refs: new Set(state.refs),
    targetsByRef: new Map(
      Object.entries(state.targetsByRef).map(([ref, paths]) => [
        ref,
        [...paths],
      ])
    ),
    elementToolTargets: new Map(
      Object.entries(state.elementToolTargets).map(([name, refs]) => [
        name,
        [...refs],
      ])
    ),
  };
}

const INSPECTOR_HOST = "[data-ayme-inspector-host]";

/** Whether a page change is only inside the Inspector's host: no reason to look again. */
export function isInspectorOwnMutation(record: MutationRecord) {
  return (
    record.target instanceof Element && record.target.matches(INSPECTOR_HOST)
  );
}

function isFromInspector(event: Event) {
  return (
    event.target instanceof Element &&
    event.target.closest(INSPECTOR_HOST) !== null
  );
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
