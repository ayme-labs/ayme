import { vi } from "vitest";

import type {
  Ayme,
  AymeWebMcpPublicationStatus,
  ToolInfo,
} from "@ayme-dev/ayme";

import type { AppProcessTool, AppProcessTools } from "@ayme-dev/ayme/internal";

// One list until a test sets another, as the session keeps it until it changes.
const NO_TOOLS: readonly ToolInfo[] = Object.freeze([]);
const NO_PROCESS_TOOLS: readonly AppProcessTool[] = Object.freeze([]);
const listeners = new Set<(tools: readonly ToolInfo[]) => void>();
const processListeners = new Set<(tools: readonly AppProcessTool[]) => void>();

/**
 * A stand-in for the started session, for tests that replace
 * `getStartedAyme` with it: they set its tools and publication status, mock
 * `tools.run`, and announce a change.
 */
export const startedAyme = {
  tools: {
    list: vi.fn((): readonly ToolInfo[] => NO_TOOLS),
    subscribe: (listener: (tools: readonly ToolInfo[]) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    run: vi.fn<(name: string, input: object) => Promise<unknown>>(),
  },
  webMCP: {
    publicationStatus: {
      state: "active",
      message: "",
    } as AymeWebMcpPublicationStatus,
    subscribe: () => () => {},
  },
  /**
   * The tools of the App Processes paired beside the page, as
   * `getAppProcessTools` gives them: tests set them, mock `run`, and
   * announce a change.
   */
  appProcessTools: {
    list: vi.fn((): readonly AppProcessTool[] => NO_PROCESS_TOOLS),
    subscribe: (listener: (tools: readonly AppProcessTool[]) => void) => {
      processListeners.add(listener);
      return () => void processListeners.delete(listener);
    },
    run: vi.fn<(name: string, input: unknown) => Promise<unknown>>(),
  },
  /** Tells subscribers the tools or the status changed. */
  announce() {
    for (const listener of listeners) listener(startedAyme.tools.list());
    for (const listener of processListeners)
      listener(startedAyme.appProcessTools.list());
  },
  /** Back to no tools, an active publication and no listeners. */
  reset() {
    startedAyme.tools.list.mockReset().mockReturnValue(NO_TOOLS);
    startedAyme.tools.run.mockReset();
    startedAyme.appProcessTools.list
      .mockReset()
      .mockReturnValue(NO_PROCESS_TOOLS);
    startedAyme.appProcessTools.run.mockReset();
    processListeners.clear();
    startedAyme.webMCP.publicationStatus = { state: "active", message: "" };
    listeners.clear();
  },
};

/** The stand-in as `getStartedAyme` returns it. */
export const asStartedAyme = () => startedAyme as unknown as Ayme;

/** The stand-in's App Process tools, as `getAppProcessTools` returns them. */
export const appProcessToolsOf = (): AppProcessTools =>
  startedAyme.appProcessTools;
