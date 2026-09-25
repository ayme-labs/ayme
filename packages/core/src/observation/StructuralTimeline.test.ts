import { describe, expect, it } from "vitest";
import { AriaRefSchema } from "../tree/StructuralTypes";
import {
  StructuralActionIdSchema,
  type StructuralActionId,
} from "./StructuralAction";
import { VisitIdSchema } from "./Visit";
import type { VisitId } from "./Visit";
import { StructuralTree } from "../tree/StructuralTree";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import {
  MonotonicTimeMsSchema,
  type MonotonicTimeMs,
} from "../capture/MonotonicTimeMs";
import { PageIdSchema, type PageId } from "../capture/PageId";
import type { StructuralTreeEvidence } from "../capture/StructuralTreeEvidence";
import {
  StructuralTimeline,
  type StructuralResolvedChange,
  type StructuralNavigationEntry,
} from "./StructuralTimeline";

function pageYaml(children: string): string {
  return `- document [ref=e0]:\n${children
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}`;
}

const INITIAL_YAML = pageYaml('- heading "Dashboard" [ref=e1]');
const PRE_ACTION_YAML = pageYaml(
  ['- heading "Dashboard" [ref=e1]', '- button "Refresh" [ref=e2]'].join("\n")
);
const MID_ACTION_YAML = pageYaml(
  [
    '- heading "Dashboard" [ref=e1]',
    '- button "Refresh" [ref=e2]',
    '- button "Archive" [ref=e3]',
  ].join("\n")
);
const POST_ACTION_YAML = pageYaml(
  [
    '- heading "Dashboard" [ref=e1]',
    '- button "Refresh" [ref=e2]',
    '- button "Archive" [ref=e3]',
    '- button "Delete" [ref=e4]',
  ].join("\n")
);

const PAGE: PageId = PageIdSchema.parse("page@test");
const OTHER_PAGE: PageId = PageIdSchema.parse("other-page@test");

const refFactory = new SyntheticAriaRefFactory();

function tree(yaml: string): StructuralTree {
  return StructuralTree.fromAriaSnapshotYaml(yaml, refFactory);
}

let actionCounter = 0;
const evidenceLabels = new WeakMap<StructuralTreeEvidence, string>();

/**
 * Wraps a parsed tree in a lazy {@link StructuralTreeEvidence} handle, mirroring how the service stores
 * observations. The tree is parsed eagerly (preserving id-assignment order across the shared factory)
 * but exposed via `resolve()` so the timeline exercises the lazy-handle path.
 */
function treeEvidence(
  yaml: string,
  options?: { at?: number; pageId?: PageId; label?: string }
): StructuralTreeEvidence {
  const parsed = tree(yaml);
  const evidence: StructuralTreeEvidence = {
    capturedAt: at(options?.at ?? 0),
    pageId: options?.pageId ?? PAGE,
    resolve: async () => parsed,
  };
  if (options?.label) evidenceLabels.set(evidence, options.label);
  return evidence;
}

/**
 * A lazy handle whose `resolve()` always rejects, mirroring an early SPA-shell visit-start snapshot
 * that replays to empty ARIA and cannot be parsed into a concrete tree.
 */
function failingTreeEvidence(options?: {
  at?: number;
  pageId?: PageId;
}): StructuralTreeEvidence {
  return {
    capturedAt: at(options?.at ?? 0),
    pageId: options?.pageId ?? PAGE,
    resolve: async () => {
      throw new Error(
        "Playwright main-world aria snapshot returned no content."
      );
    },
  };
}

function at(value: number): MonotonicTimeMs {
  return MonotonicTimeMsSchema.parse(value);
}

function visit(n: number): VisitId {
  return VisitIdSchema.parse(`visit_${n}`);
}

function actionId(): StructuralActionId {
  return StructuralActionIdSchema.parse(`interaction_test_${++actionCounter}`);
}

function addedNames(change: { changeTree: StructuralTree }): string[] {
  return change.changeTree.getNodesByStatus("added").map((node) => node.name);
}

/** Records a visit-opening navigation plus its bootstrap observation, mirroring how the service opens a visit. */
function startVisit(
  timeline: StructuralTimeline,
  options: {
    visitId: VisitId;
    at: number;
    yaml: string;
    pageId?: PageId;
    url?: string;
    fromUrl?: string | null;
  }
): StructuralNavigationEntry {
  const entry = timeline.recordNavigation({
    kind: "navigation",
    at: at(options.at),
    pageId: options.pageId ?? PAGE,
    fromUrl: options.fromUrl ?? null,
    toUrl: options.url ?? "https://example.test/",
    cause: "openPage",
    startedVisitId: options.visitId,
  });
  timeline.recordObservation({
    kind: "observation",
    at: at(options.at),
    pageId: options.pageId ?? PAGE,
    tree: treeEvidence(options.yaml, {
      at: options.at,
      pageId: options.pageId,
    }),
  });
  return entry;
}

function observe(
  timeline: StructuralTimeline,
  options: {
    at: number;
    yaml: string;
    label?: string;
    pageId?: PageId;
    capturedForActionId?: StructuralActionId;
  }
): StructuralTreeEvidence {
  const evidence = treeEvidence(options.yaml, {
    at: options.at,
    pageId: options.pageId,
    label: options.label,
  });
  timeline.recordObservation({
    kind: "observation",
    at: at(options.at),
    pageId: options.pageId ?? PAGE,
    tree: evidence,
    capturedForActionId: options.capturedForActionId,
  });
  return evidence;
}

/** Records a visit start whose bootstrap observation resolves to an empty/unparseable snapshot. */
function startVisitWithUnresolvableTree(
  timeline: StructuralTimeline,
  options: { visitId: VisitId; at: number; pageId?: PageId }
): StructuralNavigationEntry {
  const entry = timeline.recordNavigation({
    kind: "navigation",
    at: at(options.at),
    pageId: options.pageId ?? PAGE,
    fromUrl: null,
    toUrl: "https://example.test/",
    cause: "openPage",
    startedVisitId: options.visitId,
  });
  timeline.recordObservation({
    kind: "observation",
    at: at(options.at),
    pageId: options.pageId ?? PAGE,
    tree: failingTreeEvidence({ at: options.at, pageId: options.pageId }),
  });
  return entry;
}

/** Records an observation whose lazy tree handle rejects on resolve. */
function observeUnresolvable(
  timeline: StructuralTimeline,
  options: {
    at: number;
    pageId?: PageId;
    capturedForActionId?: StructuralActionId;
  }
): void {
  timeline.recordObservation({
    kind: "observation",
    at: at(options.at),
    pageId: options.pageId ?? PAGE,
    tree: failingTreeEvidence({ at: options.at, pageId: options.pageId }),
    capturedForActionId: options.capturedForActionId,
  });
}

/**
 * Records an action start/completion pair and returns the action id, mirroring the service flow. When
 * `after` is provided it also records the action's explicit post-action capture (tagged with the action
 * id), which is how the service supplies the authoritative after-state for a non-crossing action.
 */
function recordAction(
  timeline: StructuralTimeline,
  options: {
    startedAt: number;
    endedAt: number;
    pageId?: PageId;
    after?: { at: number; yaml: string; label?: string };
  }
): StructuralActionId {
  const id = actionId();
  timeline.recordActionStarted({
    kind: "action-started",
    at: at(options.startedAt),
    pageId: options.pageId ?? PAGE,
    actionId: id,
  });
  timeline.recordActionCompleted({
    kind: "action-completed",
    at: at(options.endedAt),
    pageId: options.pageId ?? PAGE,
    actionId: id,
  });
  if (options.after) {
    observe(timeline, {
      ...options.after,
      pageId: options.pageId,
      capturedForActionId: id,
    });
  }
  return id;
}

describe("StructuralTimeline", () => {
  describe("derived visits (Milestone 4A)", () => {
    it("opening navigation yields one visit read model with the opening URL", () => {
      const timeline = new StructuralTimeline();
      timeline.recordNavigation({
        kind: "navigation",
        at: at(0),
        pageId: PAGE,
        fromUrl: null,
        toUrl: "https://example.test/",
        cause: "initial",
        startedVisitId: visit(1),
      });

      expect(timeline.visits()).toEqual([
        { id: visit(1), pageId: PAGE, urls: ["https://example.test/"] },
      ]);
    });

    it("hash-only navigation appends a URL to the same derived visit", () => {
      const timeline = new StructuralTimeline();
      timeline.recordNavigation({
        kind: "navigation",
        at: at(0),
        pageId: PAGE,
        fromUrl: null,
        toUrl: "https://example.test/",
        cause: "initial",
        startedVisitId: visit(1),
      });
      timeline.recordNavigation({
        kind: "navigation",
        at: at(5),
        pageId: PAGE,
        fromUrl: "https://example.test/",
        toUrl: "https://example.test/#section",
        cause: "navigate",
      });

      expect(timeline.visits()[0]?.urls).toEqual([
        "https://example.test/",
        "https://example.test/#section",
      ]);
    });

    it("normal navigation opens the next visit", () => {
      const timeline = new StructuralTimeline();
      timeline.recordNavigation({
        kind: "navigation",
        at: at(0),
        pageId: PAGE,
        fromUrl: null,
        toUrl: "https://example.test/",
        cause: "initial",
        startedVisitId: visit(1),
      });
      timeline.recordNavigation({
        kind: "navigation",
        at: at(10),
        pageId: PAGE,
        fromUrl: "https://example.test/",
        toUrl: "https://example.test/cart",
        cause: "navigate",
        startedVisitId: visit(2),
      });

      expect(timeline.visits()).toHaveLength(2);
      expect(timeline.visits()[1]?.urls).toEqual(["https://example.test/cart"]);
    });

    it("current visit for page follows the latest visit-opening navigation", () => {
      const timeline = new StructuralTimeline();
      timeline.recordNavigation({
        kind: "navigation",
        at: at(0),
        pageId: PAGE,
        fromUrl: null,
        toUrl: "https://example.test/",
        cause: "initial",
        startedVisitId: visit(1),
      });
      timeline.recordNavigation({
        kind: "navigation",
        at: at(10),
        pageId: PAGE,
        fromUrl: "https://example.test/",
        toUrl: "https://example.test/cart",
        cause: "navigate",
        startedVisitId: visit(2),
      });

      expect(timeline.currentVisitIdForPage(PAGE)).toBe(visit(2));
    });

    it("latest navigation URL for page follows the most recent navigation entry", () => {
      const timeline = new StructuralTimeline();
      expect(timeline.latestNavigationUrlForPage(PAGE)).toBeNull();

      timeline.recordNavigation({
        kind: "navigation",
        at: at(0),
        pageId: PAGE,
        fromUrl: null,
        toUrl: "https://example.test/",
        cause: "initial",
        startedVisitId: visit(1),
      });
      expect(timeline.latestNavigationUrlForPage(PAGE)).toBe(
        "https://example.test/"
      );

      timeline.recordNavigation({
        kind: "navigation",
        at: at(5),
        pageId: PAGE,
        fromUrl: "https://example.test/",
        toUrl: "https://example.test/#section",
        cause: "navigate",
      });
      expect(timeline.latestNavigationUrlForPage(PAGE)).toBe(
        "https://example.test/#section"
      );
    });

    it("preserves unique URL behavior within a visit window", () => {
      const timeline = new StructuralTimeline();
      timeline.recordNavigation({
        kind: "navigation",
        at: at(0),
        pageId: PAGE,
        fromUrl: null,
        toUrl: "https://example.test/",
        cause: "initial",
        startedVisitId: visit(1),
      });
      timeline.recordNavigation({
        kind: "navigation",
        at: at(5),
        pageId: PAGE,
        fromUrl: "https://example.test/",
        toUrl: "https://example.test/#section",
        cause: "navigate",
      });
      timeline.recordNavigation({
        kind: "navigation",
        at: at(6),
        pageId: PAGE,
        fromUrl: "https://example.test/#section",
        toUrl: "https://example.test/#section",
        cause: "navigate",
      });

      expect(timeline.visits()[0]?.urls).toEqual([
        "https://example.test/",
        "https://example.test/#section",
      ]);
    });

    it("normalized duplicate navigation is absent from visit URLs and does not open a new visit", () => {
      const timeline = new StructuralTimeline();
      timeline.recordNavigation({
        kind: "navigation",
        at: at(0),
        pageId: PAGE,
        fromUrl: null,
        toUrl: "https://example.test/",
        cause: "initial",
        startedVisitId: visit(1),
      });
      timeline.recordNavigation({
        kind: "navigation",
        at: at(5),
        pageId: PAGE,
        fromUrl: "https://example.test/",
        toUrl: "https://example.test/#section",
        cause: "navigate",
      });
      timeline.recordNavigation({
        kind: "navigation",
        at: at(6),
        pageId: PAGE,
        fromUrl: "https://example.test/#section",
        toUrl: "https://example.test/#section",
        cause: "navigate",
      });

      expect(timeline.visits()).toHaveLength(1);
      expect(timeline.currentVisitIdForPage(PAGE)).toBe(visit(1));
      expect(timeline.visits()[0]?.urls).toEqual([
        "https://example.test/",
        "https://example.test/#section",
      ]);
    });
  });

  describe("getVisitEvidence", () => {
    it("returns the first structural observation recorded for the visit", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 10, yaml: PRE_ACTION_YAML });

      const evidence = await timeline.getVisitEvidence(visit(1));

      expect(evidence.visitId).toBe(visit(1));
      expect(
        evidence.structuralTree.getNode(AriaRefSchema.parse("e1"))?.name
      ).toBe("Dashboard");
      expect(
        evidence.structuralTree.getNode(AriaRefSchema.parse("e2"))
      ).toBeNull();
    });

    it("scopes the visit observation to the visit window across multiple visits", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      startVisit(timeline, {
        visitId: visit(2),
        at: 20,
        yaml: POST_ACTION_YAML,
      });

      expect(
        (await timeline.getVisitEvidence(visit(1))).structuralTree.getNode(
          AriaRefSchema.parse("e4")
        )
      ).toBeNull();
      expect(
        (await timeline.getVisitEvidence(visit(2))).structuralTree.getNode(
          AriaRefSchema.parse("e4")
        )?.name
      ).toBe("Delete");
    });

    it("throws for an unknown visit id", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });

      await expect(timeline.getVisitEvidence(visit(9))).rejects.toThrow(
        "No recorded visit"
      );
    });

    it("skips an unresolvable visit-start observation and returns the first resolvable one", async () => {
      const timeline = new StructuralTimeline();
      // Mirrors an SPA whose visit-start snapshot captured an empty shell that cannot be replayed.
      startVisitWithUnresolvableTree(timeline, { visitId: visit(1), at: 0 });
      observe(timeline, { at: 10, yaml: PRE_ACTION_YAML });

      const evidence = await timeline.getVisitEvidence(visit(1));

      expect(
        evidence.structuralTree.getNode(AriaRefSchema.parse("e2"))?.name
      ).toBe("Refresh");
    });

    it("rejects clearly when every visit observation fails to resolve", async () => {
      const timeline = new StructuralTimeline();
      startVisitWithUnresolvableTree(timeline, { visitId: visit(1), at: 0 });
      observeUnresolvable(timeline, { at: 10 });

      await expect(timeline.getVisitEvidence(visit(1))).rejects.toThrow(
        "No resolvable structural observation"
      );
    });
  });

  describe("getActionEvidence", () => {
    it("scopes interleaved visit and action windows to their page", async () => {
      const otherPageYaml = pageYaml('- textbox "Search" [ref=e9]');
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      startVisit(timeline, {
        visitId: visit(2),
        at: 5,
        yaml: otherPageYaml,
        pageId: OTHER_PAGE,
        url: "https://other.test/",
      });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: PRE_ACTION_YAML, label: "page-a-after" },
      });
      startVisit(timeline, {
        visitId: visit(3),
        at: 12,
        yaml: otherPageYaml,
        pageId: OTHER_PAGE,
        url: "https://other.test/results",
        fromUrl: "https://other.test/",
      });
      recordAction(timeline, {
        startedAt: 17,
        endedAt: 18,
        pageId: OTHER_PAGE,
        after: { at: 19, yaml: otherPageYaml },
      });
      timeline.recordNavigation({
        kind: "navigation",
        at: at(25),
        pageId: PAGE,
        fromUrl: "https://example.test/",
        toUrl: "https://example.test/#details",
        cause: "navigate",
      });

      const evidence = await timeline.getActionEvidence(action);

      expect({
        visitUrls: timeline
          .visits()
          .find((candidate) => candidate.id === visit(1))?.urls,
        owningVisitId: timeline.actionOwningVisitId(action),
        evidenceVisitId: evidence.visitId,
        actionAddedNames: addedNames(evidence.actionChange),
        actionSource: evidenceLabels.get(
          evidence.actionChange.sourceTreeEvidence
        ),
        crossedVisitBoundary: timeline.actionCrossedVisitBoundary(action),
        navigationSignal: timeline.getNavigationSignalForAction(action),
        owningVisitHasEnded: timeline.actionOwningVisitHasEnded(action),
      }).toEqual({
        visitUrls: ["https://example.test/", "https://example.test/#details"],
        owningVisitId: visit(1),
        evidenceVisitId: visit(1),
        actionAddedNames: ["Refresh"],
        actionSource: "page-a-after",
        crossedVisitBoundary: false,
        navigationSignal: null,
        owningVisitHasEnded: false,
      });
    });

    it("uses the supplied resolver only for selected action boundaries", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 5, yaml: PRE_ACTION_YAML, label: "before" });
      const action = recordAction(timeline, { startedAt: 10, endedAt: 20 });
      observe(timeline, {
        at: 15,
        yaml: MID_ACTION_YAML,
        label: "inside-action",
      });
      observe(timeline, {
        at: 25,
        yaml: POST_ACTION_YAML,
        label: "after",
        capturedForActionId: action,
      });

      const selected: StructuralTreeEvidence[] = [];
      await timeline.getActionEvidence(action, async (evidence) => {
        selected.push(evidence);
        return evidence.resolve();
      });

      expect(
        selected.map((evidence) => evidenceLabels.get(evidence))
      ).toContain("before");
      expect(
        selected.map((evidence) => evidenceLabels.get(evidence))
      ).toContain("after");
      expect(
        selected.map((evidence) => evidenceLabels.get(evidence))
      ).not.toContain("inside-action");
    });

    it("keeps observations sorted by recordedAt when recorded out of append order", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const action = recordAction(timeline, { startedAt: 15, endedAt: 20 });
      // Record the explicit post-action capture before the earlier poll so insertion ordering is tested.
      observe(timeline, {
        at: 30,
        yaml: MID_ACTION_YAML,
        label: "late",
        capturedForActionId: action,
      });
      observe(timeline, { at: 10, yaml: PRE_ACTION_YAML, label: "early" });

      const evidence = await timeline.getActionEvidence(action);

      expect(addedNames(evidence.unassignedChanges[0]!)).toEqual(["Refresh"]);
      expect(
        evidenceLabels.get(evidence.unassignedChanges[0]!.sourceTreeEvidence)
      ).toBe("early");
      expect(addedNames(evidence.actionChange)).toEqual(["Archive"]);
      expect(evidenceLabels.get(evidence.actionChange.sourceTreeEvidence)).toBe(
        "late"
      );
    });

    it("requires both an action-started and an action-completed entry", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 20, yaml: PRE_ACTION_YAML });
      const id = actionId();
      timeline.recordActionStarted({
        kind: "action-started",
        at: at(10),
        pageId: PAGE,
        actionId: id,
      });

      await expect(timeline.getActionEvidence(id)).rejects.toThrow(
        "No recorded action"
      );
    });

    it("throws when resolving an unknown action id", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });

      await expect(timeline.getActionEvidence(actionId())).rejects.toThrow(
        "No recorded action"
      );
    });

    it("resolves the action change from the latest before-start poll and the explicit post-action capture", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, {
        at: 5,
        yaml: PRE_ACTION_YAML,
        label: "before-action",
      });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: MID_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.visitId).toBe(visit(1));
      expect(evidence.unassignedChanges).toHaveLength(1);
      expect(addedNames(evidence.unassignedChanges[0]!)).toContain("Refresh");
      expect(
        evidenceLabels.get(evidence.unassignedChanges[0]!.sourceTreeEvidence)
      ).toBe("before-action");
      expect(addedNames(evidence.actionChange)).toEqual(["Archive"]);
      expect(evidenceLabels.get(evidence.actionChange.sourceTreeEvidence)).toBe(
        "after-action"
      );
    });

    it("returns no unassigned change when nothing changed before the action window", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: PRE_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.unassignedChanges).toEqual([]);
      expect(addedNames(evidence.actionChange)).toEqual(["Refresh"]);
    });

    it("does not surface an identical intermediate observation as an unassigned change", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 5, yaml: INITIAL_YAML, label: "unchanged-poll" });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: PRE_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.unassignedChanges).toEqual([]);
      expect(addedNames(evidence.actionChange)).toEqual(["Refresh"]);
    });

    it("does not treat an observation exactly at startedAt as a pre-action boundary", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 10, yaml: PRE_ACTION_YAML, label: "at-start" });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: MID_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.unassignedChanges).toEqual([]);
      expect(addedNames(evidence.actionChange)).toEqual(["Refresh", "Archive"]);
    });

    it("does not treat an observation exactly at endedAt as a post-action boundary", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 15, yaml: PRE_ACTION_YAML, label: "at-end" });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 30, yaml: MID_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.actionChange.timestamp).toBe(30);
      expect(addedNames(evidence.actionChange)).toEqual(["Refresh", "Archive"]);
    });

    it("ignores observations inside the action window as boundaries", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, {
        at: 5,
        yaml: PRE_ACTION_YAML,
        label: "before-action",
      });
      observe(timeline, { at: 12, yaml: MID_ACTION_YAML, label: "in-action" });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: POST_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.unassignedChanges).toHaveLength(1);
      expect(addedNames(evidence.unassignedChanges[0]!)).toEqual(["Refresh"]);
      expect(addedNames(evidence.actionChange)).toEqual(["Archive", "Delete"]);
    });

    it("resolves action evidence idempotently across repeated queries", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, {
        at: 5,
        yaml: PRE_ACTION_YAML,
        label: "before-action",
      });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: MID_ACTION_YAML, label: "after-action" },
      });

      const first = await timeline.getActionEvidence(action);
      const second = await timeline.getActionEvidence(action);

      expect(addedNames(second.actionChange)).toEqual(
        addedNames(first.actionChange)
      );
      expect(
        second.unassignedChanges.map((change) => addedNames(change))
      ).toEqual(
        first.unassignedChanges.map((change: StructuralResolvedChange) =>
          addedNames(change)
        )
      );
      expect(second.actionChange.timestamp).toBe(first.actionChange.timestamp);
    });

    it("surfaces a gap between consecutive actions as the later action unassigned change", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const firstAction = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: PRE_ACTION_YAML, label: "after-first-action" },
      });
      observe(timeline, { at: 40, yaml: MID_ACTION_YAML, label: "gap-change" });
      const secondAction = recordAction(timeline, {
        startedAt: 50,
        endedAt: 55,
        after: { at: 60, yaml: POST_ACTION_YAML, label: "after-second-action" },
      });

      const first = await timeline.getActionEvidence(firstAction);
      expect(first.unassignedChanges).toEqual([]);
      expect(addedNames(first.actionChange)).toEqual(["Refresh"]);

      const second = await timeline.getActionEvidence(secondAction);
      expect(second.unassignedChanges).toHaveLength(1);
      expect(addedNames(second.unassignedChanges[0]!)).toEqual(["Archive"]);
      expect(addedNames(second.actionChange)).toEqual(["Delete"]);
    });

    it("throws when a non-crossing action in an open window has no explicit post-action capture", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, {
        at: 5,
        yaml: PRE_ACTION_YAML,
        label: "before-action",
      });
      const action = recordAction(timeline, { startedAt: 10, endedAt: 15 });

      await expect(timeline.getActionEvidence(action)).rejects.toThrow(
        "No post-action observation recorded for action"
      );
    });

    it("carries reconciled current ids forward across actions instead of raw capture ids", async () => {
      const stableYaml = pageYaml(
        ['- button "Save" [ref=e2]', '- button "Help" [ref=e5]'].join("\n")
      );
      const withBannerYaml = pageYaml(
        [
          '- heading "Banner" [ref=e3]',
          '- button "Save" [ref=e2]',
          '- button "Help" [ref=e5]',
        ].join("\n")
      );

      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: stableYaml });
      const firstAction = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: withBannerYaml, label: "after-first" },
      });
      const secondAction = recordAction(timeline, {
        startedAt: 30,
        endedAt: 35,
        after: { at: 40, yaml: withBannerYaml, label: "after-second" },
      });

      const firstSaveId = (
        await timeline.getActionEvidence(firstAction)
      ).actionChange.changeTree.getNode(AriaRefSchema.parse("e2"))?.ref;
      const secondSaveId = (
        await timeline.getActionEvidence(secondAction)
      ).actionChange.changeTree.getNode(AriaRefSchema.parse("e2"))?.ref;

      expect(firstSaveId).toBeDefined();
      expect(secondSaveId).toBe(firstSaveId);
    });

    it("uses the explicit post-action capture even when an earlier unchanged poll exists (bello)", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const action = recordAction(timeline, { startedAt: 10, endedAt: 15 });
      // A stale poll samples the not-yet-updated page right after the action, then the explicit capture
      // records the real effect. The explicit capture must win despite its later timestamp.
      observe(timeline, { at: 16, yaml: INITIAL_YAML, label: "stale-poll" });
      observe(timeline, {
        at: 20,
        yaml: PRE_ACTION_YAML,
        label: "explicit",
        capturedForActionId: action,
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(addedNames(evidence.actionChange)).toEqual(["Refresh"]);
      expect(evidence.actionChange.timestamp).toBe(20);
      expect(evidenceLabels.get(evidence.actionChange.sourceTreeEvidence)).toBe(
        "explicit"
      );
    });

    it("treats the explicit capture as authoritative over earlier post-action polls", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const action = recordAction(timeline, { startedAt: 10, endedAt: 15 });
      observe(timeline, { at: 16, yaml: INITIAL_YAML, label: "poll-1" });
      observe(timeline, { at: 17, yaml: PRE_ACTION_YAML, label: "poll-2" });
      observe(timeline, {
        at: 20,
        yaml: MID_ACTION_YAML,
        label: "explicit",
        capturedForActionId: action,
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(addedNames(evidence.actionChange)).toEqual(["Refresh", "Archive"]);
      expect(evidenceLabels.get(evidence.actionChange.sourceTreeEvidence)).toBe(
        "explicit"
      );
    });

    it("excludes a delayed explicit capture that only completed after the next action started", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      // A genuine poll records the first action's real effect before the next action begins.
      observe(timeline, {
        at: 18,
        yaml: PRE_ACTION_YAML,
        label: "genuine-first-effect",
      });
      // The first action's own capture only lands at 28 — after the second action started — so it is
      // contaminated with the second action's effect and must not be used for the first action.
      const firstAction = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: {
          at: 28,
          yaml: MID_ACTION_YAML,
          label: "first-late-contaminated",
        },
      });
      recordAction(timeline, {
        startedAt: 20,
        endedAt: 25,
        after: { at: 30, yaml: MID_ACTION_YAML, label: "second-after" },
      });

      const evidence = await timeline.getActionEvidence(firstAction);

      expect(addedNames(evidence.actionChange)).toEqual(["Refresh"]);
      expect(evidenceLabels.get(evidence.actionChange.sourceTreeEvidence)).toBe(
        "genuine-first-effect"
      );
    });

    it("leaves the earlier action unchanged when no eligible observation predates the next action", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const firstAction = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: {
          at: 28,
          yaml: MID_ACTION_YAML,
          label: "first-late-contaminated",
        },
      });
      recordAction(timeline, {
        startedAt: 20,
        endedAt: 25,
        after: { at: 30, yaml: MID_ACTION_YAML, label: "second-after" },
      });

      const evidence = await timeline.getActionEvidence(firstAction);

      expect(addedNames(evidence.actionChange)).toEqual([]);
      expect(
        evidence.actionChange.changeTree.getNodesByStatus("updated")
      ).toEqual([]);
    });

    it("attributes a navigation-triggering action to its source visit and scopes boundaries to that window", async () => {
      const loginYaml = pageYaml('- textbox "Username" [ref=e9]');
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const action = recordAction(timeline, { startedAt: 10, endedAt: 15 });
      // Source-visit post-action observation (recorded within the source window, before navigation).
      observe(timeline, {
        at: 16,
        yaml: PRE_ACTION_YAML,
        label: "source-after",
      });
      // Destination visit opens with a completely different tree that must NOT leak into resolution.
      startVisit(timeline, { visitId: visit(2), at: 20, yaml: loginYaml });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.visitId).toBe(visit(1));
      expect(addedNames(evidence.actionChange)).toEqual(["Refresh"]);
    });

    it("attributes a crossing action (completing after the next visit started) to its source visit", async () => {
      const loginYaml = pageYaml('- textbox "Username" [ref=e9]');
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const id = actionId();
      timeline.recordActionStarted({
        kind: "action-started",
        at: at(10),
        pageId: PAGE,
        actionId: id,
      });
      // Destination visit opens before the action settles, then the action completes inside it.
      startVisit(timeline, { visitId: visit(2), at: 20, yaml: loginYaml });
      timeline.recordActionCompleted({
        kind: "action-completed",
        at: at(30),
        pageId: PAGE,
        actionId: id,
      });

      const evidence = await timeline.getActionEvidence(id);

      expect(evidence.visitId).toBe(visit(1));
      // No source post-action observation exists, so the action change is unchanged.
      expect(addedNames(evidence.actionChange)).toEqual([]);
      expect(
        evidence.actionChange.changeTree.getNodesByStatus("updated")
      ).toEqual([]);
      // The destination tree must never leak into source-action evidence.
      expect(
        evidence.actionChange.structuralTree.getNode(AriaRefSchema.parse("e9"))
      ).toBeNull();
      expect(
        evidence.actionChange.structuralTree.getNode(AriaRefSchema.parse("e1"))
          ?.name
      ).toBe("Dashboard");
    });

    it("uses the last source observation when the visit closes before a post-action observation arrives", async () => {
      const loginYaml = pageYaml('- textbox "Username" [ref=e9]');
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const action = recordAction(timeline, { startedAt: 10, endedAt: 15 });
      startVisit(timeline, { visitId: visit(2), at: 20, yaml: loginYaml });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.visitId).toBe(visit(1));
      expect(addedNames(evidence.actionChange)).toEqual([]);
      expect(
        evidence.actionChange.structuralTree.getNode(AriaRefSchema.parse("e9"))
      ).toBeNull();
    });

    it("uses a source observation recorded before navigation as a crossing action effect", async () => {
      const loginYaml = pageYaml('- textbox "Username" [ref=e9]');
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const id = actionId();
      timeline.recordActionStarted({
        kind: "action-started",
        at: at(10),
        pageId: PAGE,
        actionId: id,
      });
      // A poll captures the source DOM effect (Refresh appears) before navigation replaces the page.
      observe(timeline, {
        at: 16,
        yaml: PRE_ACTION_YAML,
        label: "source-after",
      });
      startVisit(timeline, { visitId: visit(2), at: 20, yaml: loginYaml });
      timeline.recordActionCompleted({
        kind: "action-completed",
        at: at(30),
        pageId: PAGE,
        actionId: id,
      });

      const evidence = await timeline.getActionEvidence(id);

      expect(evidence.visitId).toBe(visit(1));
      expect(addedNames(evidence.actionChange)).toEqual(["Refresh"]);
      expect(evidenceLabels.get(evidence.actionChange.sourceTreeEvidence)).toBe(
        "source-after"
      );
    });

    it("resolves a crossing action by entry position even when the destination visit shares the action-start timestamp", async () => {
      const loginYaml = pageYaml('- textbox "Username" [ref=e9]');
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      const id = actionId();
      timeline.recordActionStarted({
        kind: "action-started",
        at: at(10),
        pageId: PAGE,
        actionId: id,
      });
      // Destination visit shares the action-start timestamp; only entry position keeps the action in v1.
      startVisit(timeline, { visitId: visit(2), at: 10, yaml: loginYaml });
      timeline.recordActionCompleted({
        kind: "action-completed",
        at: at(20),
        pageId: PAGE,
        actionId: id,
      });

      const evidence = await timeline.getActionEvidence(id);

      expect(evidence.visitId).toBe(visit(1));
      expect(addedNames(evidence.actionChange)).toEqual([]);
    });

    it("falls back to the latest resolvable pre-action observation as baseline when visit-start is unresolvable", async () => {
      const timeline = new StructuralTimeline();
      startVisitWithUnresolvableTree(timeline, { visitId: visit(1), at: 0 });
      // Two resolvable pre-action observations: with the visit-start snapshot unresolvable, the LATEST
      // (Refresh+Archive) must become the baseline, so the earlier→later render is treated as unknown
      // initial state rather than a spontaneous change (no unassigned change surfaces).
      observe(timeline, {
        at: 5,
        yaml: PRE_ACTION_YAML,
        label: "early-before",
      });
      observe(timeline, {
        at: 8,
        yaml: MID_ACTION_YAML,
        label: "latest-before",
      });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: POST_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.unassignedChanges).toEqual([]);
      // Baseline is the latest pre-action snapshot (Refresh+Archive), so the action only adds Delete.
      expect(addedNames(evidence.actionChange)).toEqual(["Delete"]);
    });

    it("walks back to the previous resolvable pre-action observation when the latest candidate also fails (unresolvable visit-start)", async () => {
      const timeline = new StructuralTimeline();
      startVisitWithUnresolvableTree(timeline, { visitId: visit(1), at: 0 });
      observe(timeline, {
        at: 5,
        yaml: MID_ACTION_YAML,
        label: "previous-valid-before",
      });
      observeUnresolvable(timeline, { at: 8 });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: POST_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      // Visit-start fails, the latest pre-action candidate (@8) fails, so the baseline walks back to the
      // previous resolvable snapshot (@5, Refresh+Archive) — still no pre-first-action unassigned change.
      expect(evidence.unassignedChanges).toEqual([]);
      expect(addedNames(evidence.actionChange)).toEqual(["Delete"]);
    });

    it("skips an unresolvable latest-before candidate and uses the previous resolvable before observation", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, {
        at: 5,
        yaml: PRE_ACTION_YAML,
        label: "genuine-before",
      });
      observeUnresolvable(timeline, { at: 8 });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: MID_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      expect(evidence.unassignedChanges).toHaveLength(1);
      expect(addedNames(evidence.unassignedChanges[0]!)).toEqual(["Refresh"]);
      expect(addedNames(evidence.actionChange)).toEqual(["Archive"]);
    });

    it("rejects when the selected explicit post-action capture fails to resolve", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, {
        at: 5,
        yaml: PRE_ACTION_YAML,
        label: "before-action",
      });
      const action = recordAction(timeline, { startedAt: 10, endedAt: 15 });
      // The action's committed post-action capture is the authoritative after-state; a failure here
      // must stay loud rather than silently falling back to a poll/before snapshot.
      observeUnresolvable(timeline, { at: 20, capturedForActionId: action });

      await expect(timeline.getActionEvidence(action)).rejects.toThrow(
        "Playwright main-world aria snapshot returned no content."
      );
    });

    it("rejects when no resolvable pre-action baseline exists in the window", async () => {
      const timeline = new StructuralTimeline();
      startVisitWithUnresolvableTree(timeline, { visitId: visit(1), at: 0 });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: MID_ACTION_YAML, label: "after-action" },
      });

      await expect(timeline.getActionEvidence(action)).rejects.toThrow(
        "Unable to resolve a structural baseline"
      );
    });

    it("returns the selected before snapshot handle and reconciled before-tree on the action change", async () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, {
        at: 5,
        yaml: PRE_ACTION_YAML,
        label: "before-action",
      });
      const action = recordAction(timeline, {
        startedAt: 10,
        endedAt: 15,
        after: { at: 20, yaml: MID_ACTION_YAML, label: "after-action" },
      });

      const evidence = await timeline.getActionEvidence(action);

      // The reconciled before tree anchors removed and navigating targets to the threaded id used by
      // the change tree.
      expect(
        evidence.actionChange.beforeStructuralTree?.getNode(
          AriaRefSchema.parse("e2")
        )?.name
      ).toBe("Refresh");
    });

    it("reports whether an action crossed a visit boundary", () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 16, yaml: PRE_ACTION_YAML });
      const contained = recordAction(timeline, { startedAt: 10, endedAt: 15 });

      const crossing = actionId();
      timeline.recordActionStarted({
        kind: "action-started",
        at: at(20),
        pageId: PAGE,
        actionId: crossing,
      });
      startVisit(timeline, { visitId: visit(2), at: 30, yaml: INITIAL_YAML });
      timeline.recordActionCompleted({
        kind: "action-completed",
        at: at(40),
        pageId: PAGE,
        actionId: crossing,
      });

      expect(timeline.actionCrossedVisitBoundary(contained)).toBe(false);
      expect(timeline.actionCrossedVisitBoundary(crossing)).toBe(true);
    });

    it("returns destination visit-start info for an action crossing a visit-started boundary", () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 16, yaml: PRE_ACTION_YAML });
      recordAction(timeline, { startedAt: 10, endedAt: 15 });

      const crossing = actionId();
      timeline.recordActionStarted({
        kind: "action-started",
        at: at(20),
        pageId: PAGE,
        actionId: crossing,
      });
      startVisit(timeline, {
        visitId: visit(2),
        at: 30,
        yaml: INITIAL_YAML,
        url: "/cart",
        fromUrl: "https://example.test/",
      });
      timeline.recordActionCompleted({
        kind: "action-completed",
        at: at(40),
        pageId: PAGE,
        actionId: crossing,
      });

      expect(timeline.getNavigationSignalForAction(crossing)).toEqual({
        toUrl: "/cart",
      });
    });

    it("returns null navigation info for non-navigation actions", () => {
      const timeline = new StructuralTimeline();
      startVisit(timeline, { visitId: visit(1), at: 0, yaml: INITIAL_YAML });
      observe(timeline, { at: 16, yaml: PRE_ACTION_YAML });
      const contained = recordAction(timeline, { startedAt: 10, endedAt: 15 });

      expect(timeline.getNavigationSignalForAction(contained)).toBeNull();
    });
  });
});
