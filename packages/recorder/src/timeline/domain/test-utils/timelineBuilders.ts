import type { PageSnapshot, TimelineAddition } from "../recorded";
import { Timeline, type PackageHeader } from "../timeline";

// Builders the timeline's tests share: a package header, the first Visit, a
// snapshot of its page, and a timeline replayed from additions. Test-only:
// only tests import this folder (docs/testing.md#test-only-code).

export const header: PackageHeader = {
  recordingId: "rec_20261112T145047604Z",
  createdAt: "2026-11-12T14:50:47.604Z",
  tracePath: null,
};

export const url = "http://shop.test/";

/** The recording's first Visit, of page_1 at `url`. */
export const visit: TimelineAddition = {
  kind: "visit",
  page: "page_1",
  url,
  cause: "initial",
};

/** A snapshot of page_1, taken at `at`. */
export const snapshot = (
  id: string,
  at: number,
  tree: string
): { kind: "snapshot"; snapshot: PageSnapshot } => ({
  kind: "snapshot",
  snapshot: { id, page: "page_1", url, at, tree },
});

/** A timeline that was given these additions, in order. */
export async function timelineOf(additions: readonly TimelineAddition[]) {
  const timeline = new Timeline();
  for (const addition of additions) await timeline.add(addition);
  return timeline;
}

/** A tree of these elements under one generic root. */
export const page = (...elements: string[]) =>
  [`- generic [ref=e1]:`, ...elements.map((line) => `  ${line}`)].join("\n");

/**
 * Each entry of a package's text, in order across its Visits: its kind, and
 * its Change Tree as the compact text the package writes, without the
 * package's indent; null when it has none, and "[]" when it is empty.
 */
export function changeTreesOf(
  text: string
): { kind: string; changeTree: string | null }[] {
  return text
    .split("traceActionPoints:")[0]!
    .split("\n      - kind: ")
    .slice(1)
    .map((entry) => {
      const [, tree] = entry.split("\n        changeTree:");
      return {
        kind: entry.split("\n", 1)[0]!,
        changeTree:
          tree === undefined
            ? null
            : tree.startsWith(" []")
              ? "[]"
              : tree
                  .split("\n")
                  .filter((line) => line.startsWith("          "))
                  .map((line) => line.slice(10))
                  .join("\n"),
      };
    });
}
