import type { PageNavigating } from "../../contract";
import type { HeldCallExit, PageExit } from "./unansweredCall";

/**
 * How long the server waits for a tab that went away to reconnect, so it
 * can answer the calls in flight with the new page's tools and send the
 * calls it holds to the new page. Also how long a page that said it is
 * navigating, or that connected without reporting its tools, holds calls.
 */
export const RECONNECT_WAIT_MS = 5_000;

/**
 * The tab's previous document, gone or going, whose calls in flight wait
 * for an answer until `until`: the URL it had, and the document it said it
 * started loading, if it did.
 */
type Left = { url: string; to?: PageNavigating; until: number };

/**
 * Where the paired tab is in loading a new document, for the server to
 * know whether a page call can go out now. Times are by the clock the
 * caller passes as `now`.
 *
 * - `unpaired`: no tab.
 * - `paired`: the page reported its tools; calls go out. `to` is where it
 *   last said it was navigating, if it is still there after the wait.
 * - `navigating`: the page said it started a cross-document navigation and
 *   is still there, until `until`. A page still there after that is paired
 *   again, as when its navigation was cancelled or is slow, and keeps `to`
 *   for when it leaves.
 * - `disconnected`: the page's channel closed, and the server waits for its
 *   tab to reconnect until `left.until`.
 * - `reconnected`: a page connected, as the tab's new document or for the
 *   first time, and has not reported its tools; until `until`, after which
 *   it is paired anyway.
 *
 * Page calls are held while the tab is navigating, disconnected or
 * reconnected (see `holdsPageCalls`).
 */
export type TabLifecycle =
  | { name: "unpaired" }
  | { name: "paired"; tab: string; url: string; to?: PageNavigating }
  | {
      name: "navigating";
      tab: string;
      url: string;
      to: PageNavigating;
      until: number;
      left?: Left;
    }
  | { name: "disconnected"; tab: string; left: Left }
  | {
      name: "reconnected";
      tab: string;
      url: string;
      until: number;
      left?: Left;
    };

/**
 * A lifecycle after an event, with what the server does about it: answer
 * the previous document's calls in flight as `left` says, and answer the
 * held calls without running them as `held` says. When `held` is absent and
 * the new lifecycle holds no page calls, the held calls go out.
 */
export type Transition = {
  lifecycle: TabLifecycle;
  left?: PageExit;
  held?: HeldCallExit;
};

export const unpaired: TabLifecycle = { name: "unpaired" };

/** Whether a call for the page waits rather than going out now. */
export function holdsPageCalls(lifecycle: TabLifecycle): boolean {
  return (
    lifecycle.name === "navigating" ||
    lifecycle.name === "disconnected" ||
    lifecycle.name === "reconnected"
  );
}

/** When the lifecycle next changes by time alone, if it does. */
export function deadline(lifecycle: TabLifecycle): number | undefined {
  switch (lifecycle.name) {
    case "disconnected":
      return lifecycle.left.until;
    case "navigating":
    case "reconnected":
      return lifecycle.left?.until ?? lifecycle.until;
    default:
      return undefined;
  }
}

/**
 * A page of the tab `tab` connected at `url`. Another tab's page replaces
 * the paired tab, whose calls are answered; the same tab's earlier
 * document, connected or not, is left.
 */
export function attached(
  lifecycle: TabLifecycle,
  tab: string,
  url: string,
  now: number
): Transition {
  const page = {
    name: "reconnected",
    tab,
    url,
    until: now + RECONNECT_WAIT_MS,
  } as const;
  if (lifecycle.name === "unpaired") return { lifecycle: page };
  if (lifecycle.tab !== tab)
    return {
      lifecycle: page,
      left: { type: "replaced" },
      held: { type: "replaced" },
    };
  return { lifecycle: { ...page, left: leave(lifecycle, now) } };
}

/** The page said it started a cross-document navigation to `to`. */
export function navigating(
  lifecycle: TabLifecycle,
  to: PageNavigating,
  now: number
): Transition {
  if (lifecycle.name === "unpaired" || lifecycle.name === "disconnected")
    return { lifecycle };
  const { tab, url } = lifecycle;
  const left = lifecycle.name === "paired" ? undefined : lifecycle.left;
  return {
    lifecycle: {
      name: "navigating",
      tab,
      url,
      to,
      until: now + RECONNECT_WAIT_MS,
      ...(left ? { left } : {}),
    },
  };
}

/** The page's channel closed: the server waits for its tab to reconnect. */
export function disconnected(lifecycle: TabLifecycle, now: number): Transition {
  if (lifecycle.name === "unpaired" || lifecycle.name === "disconnected")
    return { lifecycle };
  return {
    lifecycle: {
      name: "disconnected",
      tab: lifecycle.tab,
      left: leave(lifecycle, now),
    },
  };
}

/**
 * The page reported `tools`. A tab's new page is paired, unless it is
 * navigating already, and the previous document's calls are answered with
 * how it left and the new page's tools.
 */
export function reported(
  lifecycle: TabLifecycle,
  tools: readonly string[]
): Transition {
  if (lifecycle.name !== "reconnected" && lifecycle.name !== "navigating")
    return { lifecycle };
  const { left, ...rest } = lifecycle;
  const { tab, url } = rest;
  const next: TabLifecycle =
    rest.name === "reconnected" ? { name: "paired", tab, url } : rest;
  if (!left) return { lifecycle: next };
  const reload = left.to?.reload ?? url === left.url;
  return {
    lifecycle: next,
    left: { type: reload ? "reloaded" : "navigated", url, tools },
  };
}

/**
 * Time passed to `now`. The previous document's calls are answered with how
 * it left once the wait for it ends, and the held calls too when no page of
 * the tab came back. A page that said it was navigating but is still there,
 * or never reported its tools, is paired.
 */
export function elapsed(lifecycle: TabLifecycle, now: number): Transition {
  if (lifecycle.name === "unpaired" || lifecycle.name === "paired")
    return { lifecycle };
  const { left } = lifecycle;
  if (left && left.until <= now) {
    const exit = exitOf(left);
    if (lifecycle.name === "disconnected")
      return { lifecycle: unpaired, left: exit, held: exit };
    return { ...elapsed({ ...lifecycle, left: undefined }, now), left: exit };
  }
  if (lifecycle.name === "disconnected" || lifecycle.until > now)
    return { lifecycle };
  const { tab, url } = lifecycle;
  const to = lifecycle.name === "navigating" ? lifecycle.to : undefined;
  return { lifecycle: { name: "paired", tab, url, ...(to ? { to } : {}) } };
}

/** The server stopped: every call still waiting is answered. */
export function stopped(): Transition {
  return {
    lifecycle: unpaired,
    left: { type: "stopped" },
    held: { type: "stopped" },
  };
}

/**
 * The tab's current document, as it leaves at `now`. A document that left
 * while an earlier one's calls still wait joins them: they keep the
 * earlier wait, and the newer word on where the tab went.
 */
function leave(
  lifecycle: Exclude<TabLifecycle, { name: "unpaired" }>,
  now: number
): Left {
  if (lifecycle.name === "disconnected") return lifecycle.left;
  const to = lifecycle.name === "reconnected" ? undefined : lifecycle.to;
  const earlier = lifecycle.name === "paired" ? undefined : lifecycle.left;
  if (earlier) return to ? { ...earlier, to } : earlier;
  return {
    url: lifecycle.url,
    until: now + RECONNECT_WAIT_MS,
    ...(to ? { to } : {}),
  };
}

/** How a document left when no page of its tab answered for it in time. */
function exitOf({ to }: Left): HeldCallExit {
  return to
    ? { type: to.reload ? "reloaded" : "navigated", url: to.url }
    : { type: "closed" };
}
