import { useSyncExternalStore } from "react";

import type { AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";
import type { PublishedToolInfo } from "@ayme-dev/ayme/internal";
import {
  getPublicationStatus,
  listLiveTools,
  subscribeToPublishedTools,
} from "@ayme-dev/ayme/internal";

/** The tools the panel can run now, and how WebMCP publication stands. */
export type LiveTools = Readonly<{
  /**
   * Every live tool, in publication order: each one the panel (and
   * `runTool`) can run now because its Page Object or element is on the
   * page, whether or not WebMCP has it. `publication` says whether agents
   * can call them.
   */
  live: readonly PublishedToolInfo[];
  /** WebMCP publication; a failure carries its error in `message`. */
  publication: AymeWebMcpPublicationStatus;
}>;

let snapshot: LiveTools | undefined;

// useSyncExternalStore needs the same object until something changes: the
// runtime hands back the same list and status until they change, so keep one
// pair.
function readLiveTools(): LiveTools {
  const live = listLiveTools();
  const publication = getPublicationStatus();
  if (snapshot?.live !== live || snapshot.publication !== publication)
    snapshot = Object.freeze({ live, publication });
  return snapshot;
}

/**
 * The live tools and the publication status, kept current: the runtime
 * announces publication and registry changes alike.
 */
export function useLiveTools(): LiveTools {
  return useSyncExternalStore(subscribeToPublishedTools, readLiveTools);
}
