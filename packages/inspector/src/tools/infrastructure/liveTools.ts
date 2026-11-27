import type {
  AymeWebMcpPublicationStatus,
  ToolInfo,
} from "@ayme-dev/ayme/inspector";

import {
  inspectorClient,
  useInspectorState,
  type InspectorClient,
} from "../../shared/infrastructure";

/** The tools the panel can run now, and whether agents reach them through WebMCP. */
export type LiveTools = Readonly<{
  /**
   * Every tool the session lists, in publication order: each one whose Page
   * Object or element is on the page, whether or not WebMCP has it. A tool
   * can be listed and unavailable (ADR-0062): `available` says whether a
   * call would run it, and `reason` why not. `publication` says whether
   * agents can call them.
   */
  live: readonly ToolInfo[];
  /** WebMCP publication; a failure carries its error in `message`. */
  publication: AymeWebMcpPublicationStatus;
}>;

let snapshot: LiveTools | undefined;

// The same object until something changes: the contract hands back the same
// lists and statuses until they change, so keep one set.
function liveToolsOf(client: InspectorClient): LiveTools {
  const state = client.current();
  const live = state.tools;
  const publication: AymeWebMcpPublicationStatus = state.publication;
  if (snapshot?.live !== live || snapshot.publication !== publication)
    snapshot = Object.freeze({ live, publication });
  return snapshot;
}

/**
 * The live tools and the publication status of the started session, read
 * from the Inspector contract and kept current: the runtime announces each
 * change.
 */
export function useLiveTools(
  client: InspectorClient = inspectorClient()
): LiveTools {
  useInspectorState(client);
  return liveToolsOf(client);
}
