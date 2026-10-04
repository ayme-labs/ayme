import { useSyncExternalStore } from "react";

import type { AymeWebMcpPublicationStatus, ToolInfo } from "@ayme-dev/ayme";
import {
  getStartedAyme,
  subscribeToStartedAyme,
} from "@ayme-dev/ayme/internal";

/** The tools the panel can run now, and how WebMCP publication stands. */
export type LiveTools = Readonly<{
  /**
   * Every live tool, in publication order: each one the panel (and the
   * session's `tools.run`) can run now because its Page Object or element is
   * on the page, whether or not WebMCP has it. `publication` says whether
   * agents can call them.
   */
  live: readonly ToolInfo[];
  /** WebMCP publication; a failure carries its error in `message`. */
  publication: AymeWebMcpPublicationStatus;
}>;

const NO_TOOLS: readonly ToolInfo[] = Object.freeze([]);
const NO_SESSION: AymeWebMcpPublicationStatus = Object.freeze({
  state: "disposed",
  message: "No Ayme runtime session has started.",
});

let snapshot: LiveTools | undefined;

// useSyncExternalStore needs the same object until something changes: the
// session hands back the same list and status until they change, so keep one
// pair.
function readLiveTools(): LiveTools {
  const ayme = getStartedAyme();
  const live = ayme?.tools.list() ?? NO_TOOLS;
  const publication = ayme?.webMCP.publicationStatus ?? NO_SESSION;
  if (snapshot?.live !== live || snapshot.publication !== publication)
    snapshot = Object.freeze({ live, publication });
  return snapshot;
}

/** Follow the started session's tools and publication, across sessions. */
function subscribe(onChange: () => void) {
  let unsubscribeFromSession = () => {};
  const follow = () => {
    unsubscribeFromSession();
    const ayme = getStartedAyme();
    if (!ayme) {
      unsubscribeFromSession = () => {};
      return;
    }
    const unsubscribeFromTools = ayme.tools.subscribe(onChange);
    const unsubscribeFromStatus = ayme.webMCP.subscribe(onChange);
    unsubscribeFromSession = () => {
      unsubscribeFromTools();
      unsubscribeFromStatus();
    };
  };
  const unsubscribeFromStarted = subscribeToStartedAyme(() => {
    follow();
    onChange();
  });
  follow();
  return () => {
    unsubscribeFromStarted();
    unsubscribeFromSession();
  };
}

/**
 * The live tools and the publication status of the started session, kept
 * current: the session announces tool and publication changes alike.
 */
export function useLiveTools(): LiveTools {
  return useSyncExternalStore(subscribe, readLiveTools);
}
