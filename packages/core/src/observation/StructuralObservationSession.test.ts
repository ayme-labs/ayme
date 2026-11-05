import { describe, expect, it } from "vitest";
import { MonotonicTimeMsSchema } from "../capture/MonotonicTimeMs";
import { PageIdSchema } from "../capture/PageId";
import { StructuralTree } from "../tree/StructuralTree";
import { SyntheticAriaRefFactory } from "../tree/SyntheticAriaRefFactory";
import { AriaRefSchema } from "../tree/StructuralTypes";
import {
  StructuralActionIdSchema,
  type StructuralActionId,
} from "./StructuralAction";
import { StructuralObservationSession } from "./StructuralObservationSession";
import {
  VisitWithoutObservationError,
  type StructuralObservationEntry,
} from "./StructuralTimeline";
import { VisitIdSchema, type VisitId } from "./Visit";

const PAGE = PageIdSchema.parse("page@test");

function sessionWithClock(values: number[]): StructuralObservationSession {
  let index = 0;
  return new StructuralObservationSession({
    clock: {
      now: () =>
        MonotonicTimeMsSchema.parse(values[index++] ?? values.at(-1) ?? 0),
    },
  });
}

describe("StructuralObservationSession", () => {
  it("stages a navigation until commit and exposes committed visits through a defensive copy", () => {
    const session = sessionWithClock([10]);
    const prepared = session.prepareNavigation({
      pageId: PAGE,
      url: "https://example.test/one",
      cause: "initial",
    });

    expect(session.getVisits()).toEqual([]);
    expect(prepared.registration.kind).toBe("visit-started");

    prepared.commit();
    const visits = session.getVisits();
    visits.push({
      id: VisitIdSchema.parse("visit_999"),
      pageId: PAGE,
      urls: ["https://example.test/fake"],
    });
    visits[0]!.urls.push("https://example.test/mutated");

    expect(session.getVisits()).toEqual([
      expect.objectContaining({
        pageId: PAGE,
        urls: ["https://example.test/one"],
      }),
    ]);
  });

  it("orders visits by the session timeline and ignores normalized duplicate URLs", () => {
    const session = sessionWithClock([20, 10, 30]);

    session.recordNavigation({
      pageId: PAGE,
      url: "https://example.test/two",
      cause: "initial",
    });
    session.recordNavigation({
      pageId: PAGE,
      url: "https://example.test/one",
      cause: "navigate",
    });
    const duplicate = session.recordNavigation({
      pageId: PAGE,
      url: "https://EXAMPLE.test/two",
      cause: "navigate",
    });

    expect(duplicate).toEqual({ kind: "ignored" });
    expect(session.getVisits().map((visit) => visit.urls)).toEqual([
      ["https://example.test/one"],
      ["https://example.test/two"],
    ]);
  });

  it("keeps hash-only navigations in the current visit URL history", () => {
    const session = sessionWithClock([1, 2]);

    session.recordNavigation({
      pageId: PAGE,
      url: "https://example.test/",
      cause: "initial",
    });
    const registration = session.recordNavigation({
      pageId: PAGE,
      url: "https://example.test/#details",
      cause: "navigate",
    });

    expect(registration.kind).toBe("navigation-recorded");
    expect(session.getVisits()[0]?.urls).toEqual([
      "https://example.test/",
      "https://example.test/#details",
    ]);
  });
});

it.each(["https://example.test/two", "https://example.test/#details"])(
  "commits a prepared navigation only once: %s",
  (url) => {
    const session = sessionWithClock([1, 2]);
    session.recordNavigation({
      pageId: PAGE,
      url: "https://example.test/",
      cause: "initial",
    });
    const prepared = session.prepareNavigation({
      pageId: PAGE,
      url,
      cause: "navigate",
    });
    const first = prepared.commit();
    const visits = session.getVisits();
    expect(prepared.commit()).toBe(first);
    expect(session.getVisits()).toEqual(visits);
  }
);

describe("StructuralObservationSession identity ledger", () => {
  const ref = AriaRefSchema.parse;

  function recordingSession() {
    let now = 0;
    const session = new StructuralObservationSession({
      clock: { now: () => ++now },
    });
    const at = () => MonotonicTimeMsSchema.parse(++now);
    const observe = (
      yaml: string,
      capturedForActionId?: StructuralActionId,
      resolve?: () => Promise<StructuralTree>
    ) => {
      const observedAt = at();
      const observed = StructuralTree.fromAriaSnapshotYaml(
        yaml,
        new SyntheticAriaRefFactory()
      );
      return session.recordObservation({
        kind: "observation",
        at: observedAt,
        pageId: PAGE,
        tree: {
          pageId: PAGE,
          capturedAt: observedAt,
          resolve: resolve ?? (async () => observed),
        },
        ...(capturedForActionId ? { capturedForActionId } : {}),
      });
    };
    const startAction = (id: string) => {
      const actionId = StructuralActionIdSchema.parse(id);
      session.recordActionStarted({
        kind: "action-started",
        at: at(),
        pageId: PAGE,
        actionId,
      });
      return actionId;
    };
    const navigate = (url: string, cause: "initial" | "navigate") =>
      session.recordNavigation({ pageId: PAGE, url, cause });
    const ledger = () => session.readIdentityLedger(PAGE, (read) => read);
    return { session, observe, startAction, navigate, ledger };
  }

  it("reconciles observations in recording order and attributes each to its Visit and action", async () => {
    const { observe, startAction, navigate, ledger } = recordingSession();
    navigate("https://example.test/", "initial");
    observe('- button "Save" [ref=e1]');
    const actionId = startAction("interaction_1");
    observe('- button "Save" [ref=e4]\n- status "Saved" [ref=e5]', actionId);

    const read = await ledger();

    expect(read.resolve(ref("e1"))).toMatchObject({ currentRef: "e4" });
    expect(read.lifecycle(ref("e5"))?.appeared).toEqual({
      visitId: "visit_1",
      afterActionId: actionId,
    });
    expect(read.lifecycle(ref("e1"))?.appeared).toEqual({
      visitId: "visit_1",
      afterActionId: null,
    });
  });

  it("keeps continuity across a same-document route change and attributes a removal to the action and Visit it happened in", async () => {
    const { observe, startAction, navigate, ledger } = recordingSession();
    navigate("https://example.test/", "initial");
    observe('- button "Save" [ref=e1]\n- status "Draft" [ref=e2]');
    navigate("https://example.test/orders", "navigate");
    observe('- button "Save" [ref=e3]\n- status "Draft" [ref=e4]');
    const clear = startAction("interaction_1");
    observe('- button "Save" [ref=e5]', clear);

    const read = await ledger();

    expect(read.resolve(ref("e1"))).toMatchObject({
      status: "resolved",
      currentRef: "e5",
    });
    expect(read.resolve(ref("e2"))).toMatchObject({
      status: "unresolved",
      reason: "removed",
    });
    expect(read.lifecycle(ref("e2"))).toEqual({
      appeared: { visitId: "visit_1", afterActionId: null },
      disappeared: { visitId: "visit_2", afterActionId: clear },
    });
  });

  it("attributes an action's before observation, recorded once the action started, to the action before it", async () => {
    const { session, observe, startAction, navigate, ledger } =
      recordingSession();
    navigate("https://example.test/", "initial");
    observe('- button "Save" [ref=e1]');
    const first = startAction("interaction_1");
    observe('- button "Save" [ref=e2]', first);
    const second = startAction("interaction_2");
    const observedAt = MonotonicTimeMsSchema.parse(100);
    const before = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e3]\n- status "Draft" [ref=e4]',
      new SyntheticAriaRefFactory()
    );
    session.recordObservation({
      kind: "observation",
      at: observedAt,
      pageId: PAGE,
      tree: {
        pageId: PAGE,
        capturedAt: observedAt,
        resolve: async () => before,
      },
      capturedForActionId: second,
      relation: "before",
    });

    expect((await ledger()).lifecycle(ref("e4"))?.appeared).toEqual({
      visitId: "visit_1",
      afterActionId: first,
    });
  });

  it("attributes an observation to the latest action started by its time, not by when it was recorded", async () => {
    const { session, observe, startAction, navigate, ledger } =
      recordingSession();
    navigate("https://example.test/", "initial");
    const observedAt = MonotonicTimeMsSchema.parse(
      observe('- button "Save" [ref=e1]').at + 0.5
    );
    startAction("interaction_1");
    const late = StructuralTree.fromAriaSnapshotYaml(
      '- button "Save" [ref=e2]\n- status "Draft" [ref=e3]',
      new SyntheticAriaRefFactory()
    );
    session.recordObservation({
      kind: "observation",
      at: observedAt,
      pageId: PAGE,
      tree: { pageId: PAGE, capturedAt: observedAt, resolve: async () => late },
    });

    expect((await ledger()).lifecycle(ref("e3"))?.appeared).toEqual({
      visitId: "visit_1",
      afterActionId: null,
    });
  });

  it("attributes an observation stamped at an action's start to that action, and ignores other pages' actions", async () => {
    const { session, navigate, ledger } = recordingSession();
    navigate("https://example.test/", "initial");
    const record = (at: number, yaml: string) => {
      const observedAt = MonotonicTimeMsSchema.parse(at);
      const tree = StructuralTree.fromAriaSnapshotYaml(
        yaml,
        new SyntheticAriaRefFactory()
      );
      session.recordObservation({
        kind: "observation",
        at: observedAt,
        pageId: PAGE,
        tree: {
          pageId: PAGE,
          capturedAt: observedAt,
          resolve: async () => tree,
        },
      });
    };
    const start = (at: number, id: string, pageId = PAGE) => {
      const actionId = StructuralActionIdSchema.parse(id);
      session.recordActionStarted({
        kind: "action-started",
        at: MonotonicTimeMsSchema.parse(at),
        pageId,
        actionId,
      });
      return actionId;
    };
    record(10, '- button "Save" [ref=e1]');
    const onPage = start(20, "interaction_1");
    start(20, "interaction_2", PageIdSchema.parse("page@other"));
    record(20, '- button "Save" [ref=e2]\n- status "Draft" [ref=e3]');

    expect((await ledger()).lifecycle(ref("e3"))?.appeared).toEqual({
      visitId: "visit_1",
      afterActionId: onPage,
    });
  });

  it("hands `read` the observation it last reconciled", async () => {
    const { session, observe } = recordingSession();
    observe('- button "Save" [ref=e1]');
    const latest = observe('- button "Save" [ref=e2]');

    await expect(
      session.readIdentityLedger(PAGE, (_, through) => through)
    ).resolves.toBe(latest);
  });

  it("fails the read, rather than skipping lineage, when an observation does not resolve", async () => {
    const { observe, ledger } = recordingSession();
    observe('- button "Save" [ref=e1]');
    let broken = true;
    observe('- button "Save" [ref=e2]', undefined, async () => {
      if (broken) throw new Error("unresolvable");
      return StructuralTree.fromAriaSnapshotYaml(
        '- button "Save" [ref=e2]',
        new SyntheticAriaRefFactory()
      );
    });

    await expect(ledger()).rejects.toThrow("unresolvable");
    broken = false;
    expect((await ledger()).resolve(ref("e1"))).toMatchObject({
      currentRef: "e2",
    });
  });

  it("drops an observation the ledger rejects, failing only the read that reached it", async () => {
    const { observe, ledger } = recordingSession();
    observe('- button "Save" [ref=e1]');
    observe('- button "Save" [ref=e2]\n- button "Cancel" [ref=e2]');

    await expect(ledger()).rejects.toThrow(
      "Structural Ref e2 names more than one node"
    );
    expect((await ledger()).resolve(ref("e1"))).toMatchObject({
      currentRef: "e1",
    });

    observe('- button "Save" [ref=e3]');
    expect((await ledger()).resolve(ref("e1"))).toMatchObject({
      currentRef: "e3",
    });
  });
});

describe("StructuralObservationSession readChange", () => {
  const ref = AriaRefSchema.parse;

  function recordingSession() {
    let now = 0;
    const session = new StructuralObservationSession({
      clock: { now: () => ++now },
    });
    const at = () => MonotonicTimeMsSchema.parse(++now);
    const observe = (
      yaml: string,
      action?: {
        capturedForActionId: StructuralActionId;
        relation?: "before" | "after";
      },
      pageId = PAGE
    ) => {
      const observedAt = at();
      const observed = StructuralTree.fromAriaSnapshotYaml(
        yaml,
        new SyntheticAriaRefFactory()
      );
      return session.recordObservation({
        kind: "observation",
        at: observedAt,
        pageId,
        tree: { pageId, capturedAt: observedAt, resolve: async () => observed },
        ...action,
      });
    };
    const startAction = (id: string) => {
      const actionId = StructuralActionIdSchema.parse(id);
      session.recordActionStarted({
        kind: "action-started",
        at: at(),
        pageId: PAGE,
        actionId,
      });
      return actionId;
    };
    const completeAction = (actionId: StructuralActionId) =>
      session.recordActionCompleted({
        kind: "action-completed",
        at: at(),
        pageId: PAGE,
        actionId,
      });
    const navigate = (url: string, cause: "initial" | "navigate") =>
      session.recordNavigation({ pageId: PAGE, url, cause });
    return { session, observe, startAction, completeAction, navigate };
  }

  it("reads what changed between two observations, keeping the identity of the nodes present in both", async () => {
    const { session, observe } = recordingSession();
    const from = observe('- button "Save" [ref=e1]\n- status "Draft" [ref=e2]');
    const to = observe(
      '- button "Save" [ref=e1]\n- status "Saved" [ref=e2]\n- alert "Done" [ref=e3]'
    );

    const change = await session.readChange(PAGE, from, to);

    expect(change.getNodesByStatus("added").map((node) => node.ref)).toEqual([
      "e3",
    ]);
    expect(change.getNodesByStatus("removed")).toEqual([]);
    expect(change.getNode(ref("e2"))?.status).toMatchObject({
      kind: "updated",
      selfChanged: true,
    });
    expect(change.getBeforeNodeForAfterRef(ref("e1"))?.ref).toBe("e1");
    expect(change.getNode(ref("e1"))?.status).toEqual({ kind: "unchanged" });
  });

  it("reads across the observations in between and across a same-document route change", async () => {
    const { session, observe, navigate } = recordingSession();
    navigate("https://example.test/", "initial");
    const from = observe('- button "Save" [ref=e1]\n- status "Draft" [ref=e2]');
    observe('- button "Save" [ref=e1]\n- status "Saving" [ref=e2]');
    navigate("https://example.test/orders", "navigate");
    const to = observe('- button "Save" [ref=e1]\n- list "Orders" [ref=e4]');

    const change = await session.readChange(PAGE, from, to);

    expect(change.getNodesByStatus("added").map((node) => node.ref)).toEqual([
      "e4",
    ]);
    expect(change.getNodesByStatus("removed").map((node) => node.ref)).toEqual([
      "e2",
    ]);
    expect(change.getNode(ref("e1"))?.status).toEqual({ kind: "unchanged" });
  });

  it("reads a node removed and replaced by a look-alike in between as removed and added, as the ledger has it", async () => {
    const { session, observe } = recordingSession();
    const from = observe(
      '- document [ref=e0]:\n  - button "Save" [ref=e1]\n  - status "Draft" [ref=e9]'
    );
    observe('- document [ref=e0]:\n  - status "Draft" [ref=e9]');
    const to = observe(
      '- document [ref=e0]:\n  - button "Save" [ref=e2]\n  - status "Draft" [ref=e9]'
    );

    const change = await session.readChange(PAGE, from, to);

    expect(change.getNodesByStatus("removed").map((node) => node.ref)).toEqual([
      "e1",
    ]);
    expect(change.getNodesByStatus("added").map((node) => node.ref)).toEqual([
      "e2",
    ]);
    expect(change.getBeforeNodeForAfterRef(ref("e2"))).toBeNull();
    expect(change.getNode(ref("e9"))?.status).toEqual({ kind: "unchanged" });
    const ledger = await session.readIdentityLedger(PAGE, (read) => read);
    expect(ledger.resolve(ref("e1"))).toMatchObject({
      status: "unresolved",
      reason: "removed",
    });
  });

  it("reads an observation recorded before an action like any other, and never takes it as the action's after", async () => {
    const { session, observe, startAction, completeAction } =
      recordingSession();
    session.recordNavigation({
      pageId: PAGE,
      url: "https://example.test/",
      cause: "initial",
    });
    observe('- button "Save" [ref=e1]');
    // A host starts the action, then captures its before.
    const actionId = startAction("interaction_1");
    const before = observe(
      '- button "Save" [ref=e1]\n- status "Draft" [ref=e2]',
      {
        capturedForActionId: actionId,
        relation: "before",
      }
    );
    completeAction(actionId);
    const after = observe(
      '- button "Save" [ref=e1]\n- status "Saved" [ref=e2]',
      {
        capturedForActionId: actionId,
      }
    );

    const change = await session.readChange(PAGE, before, after);
    expect(change.getNode(ref("e2"))?.status).toMatchObject({
      kind: "updated",
    });

    const evidence = await session.getActionEvidence(actionId);
    expect(evidence.actionChange.sourceTreeEvidence).toBe(after.tree);
    expect(
      evidence.actionChange.beforeStructuralTree?.getNode(ref("e2"))?.name
    ).toBe("Draft");

    const ledger = await session.readIdentityLedger(PAGE, (read) => read);
    expect(ledger.lifecycle(ref("e2"))?.appeared).toEqual({
      visitId: "visit_1",
      afterActionId: null,
    });
  });

  it("refuses an observation of another page", async () => {
    const { session, observe } = recordingSession();
    const from = observe('- button "Save" [ref=e1]');
    const other = observe(
      '- button "Save" [ref=e1]',
      undefined,
      PageIdSchema.parse("page@other")
    );

    await expect(session.readChange(PAGE, from, other)).rejects.toThrow(
      "page@other"
    );
  });
});

describe("StructuralObservationSession visit-start capture that completes after the next navigation", () => {
  const ref = AriaRefSchema.parse;

  /**
   * Visit A opens at 100 and is captured at 150. Visit B opens at 200, but the
   * page navigates again at 210, opening C, before B's start capture returns
   * at 260. C's own start capture returns at 300.
   */
  function racedSession(options: { tagged: boolean }) {
    let now = 0;
    const session = new StructuralObservationSession({
      clock: { now: () => now },
    });
    const navigate = (at: number, url: string) => {
      now = at;
      const registration = session.recordNavigation({
        pageId: PAGE,
        url,
        cause: "navigate",
      });
      if (registration.kind !== "visit-started")
        throw new Error("Expected the navigation to start a visit.");
      return registration.visit.id;
    };
    const observe = (
      at: number,
      yaml: string,
      extra: Partial<StructuralObservationEntry> = {}
    ) => {
      const observedAt = MonotonicTimeMsSchema.parse(at);
      const tree = StructuralTree.fromAriaSnapshotYaml(
        yaml,
        new SyntheticAriaRefFactory()
      );
      return session.recordObservation({
        kind: "observation",
        at: observedAt,
        pageId: PAGE,
        tree: {
          pageId: PAGE,
          capturedAt: observedAt,
          resolve: async () => tree,
        },
        ...extra,
      });
    };
    const action = (
      startedAt: number,
      completedAt: number,
      afterYaml: string,
      id = "interaction_1"
    ) => {
      const actionId = StructuralActionIdSchema.parse(id);
      session.recordActionStarted({
        kind: "action-started",
        at: MonotonicTimeMsSchema.parse(startedAt),
        pageId: PAGE,
        actionId,
      });
      observe(completedAt - 1, afterYaml, { capturedForActionId: actionId });
      session.recordActionCompleted({
        kind: "action-completed",
        at: MonotonicTimeMsSchema.parse(completedAt),
        pageId: PAGE,
        actionId,
      });
      return actionId;
    };

    const a = navigate(100, "https://app.test/");
    observe(150, '- heading "A" [ref=e1]', { capturedForVisitId: a });
    const b = navigate(200, "https://app.test/?step=1");
    const c = navigate(210, "https://app.test/?step=2");
    const lateB = () =>
      observe(
        260,
        '- heading "B" [ref=e2]\n- button "Only in B" [ref=e4]',
        options.tagged ? { capturedForVisitId: b } : {}
      );
    const startC = () =>
      observe(300, '- heading "C" [ref=e3]\n- link "Only in C" [ref=e5]', {
        capturedForVisitId: c,
      });
    return { session, a, b, c, lateB, startC, action, observe, ref };
  }

  const headingOf = (tree: StructuralTree) =>
    tree.getAllNodes().find((node) => node.role === "heading")?.name;

  it("takes each visit's baseline from the capture taken for it", async () => {
    const { session, a, b, c, lateB, startC } = racedSession({ tagged: true });
    lateB();
    startC();

    const baselines = await Promise.all(
      [a, b, c].map(async (visitId) =>
        headingOf((await session.getVisitEvidence(visitId)).structuralTree)
      )
    );

    expect(baselines).toEqual(["A", "B", "C"]);
  });

  it("records the nodes a visit's late start capture shows as appearing in that visit", async () => {
    const { session, b, c, lateB, startC, ref } = racedSession({
      tagged: true,
    });
    lateB();
    startC();

    const ledger = await session.readIdentityLedger(PAGE, (read) => read);

    expect(ledger.lifecycle(ref("e4"))?.appeared.visitId).toBe(b);
    expect(ledger.lifecycle(ref("e5"))?.appeared.visitId).toBe(c);
  });

  it("starts the next visit's first action from that visit's own capture, with no change carried over from the late one", async () => {
    const { session, c, lateB, startC, action } = racedSession({
      tagged: true,
    });
    lateB();
    startC();
    const actionId = action(
      400,
      450,
      '- heading "C" [ref=e3]\n- link "Only in C" [ref=e5]\n- status "Done" [ref=e6]'
    );

    const evidence = await session.getActionEvidence(actionId);

    expect(evidence.visitId).toBe(c);
    expect(evidence.unassignedChanges).toEqual([]);
    expect(headingOf(evidence.actionChange.beforeStructuralTree!)).toBe("C");
  });

  it("resolves an action started in the visit whose start capture landed late", async () => {
    const { session, b, lateB, startC, action } = racedSession({
      tagged: true,
    });
    const actionId = action(
      205,
      320,
      '- heading "C" [ref=e3]\n- status "Done" [ref=e6]'
    );
    lateB();
    startC();

    const evidence = await session.getActionEvidence(actionId);

    expect(evidence.visitId).toBe(b);
    expect(headingOf(evidence.actionChange.beforeStructuralTree!)).toBe("B");
  });

  it("takes a navigating action's after from its destination visit, never from a capture taken for another visit", async () => {
    const { session, a, lateB, observe } = racedSession({ tagged: true });
    const actionId = StructuralActionIdSchema.parse("interaction_1");
    session.recordActionStarted({
      kind: "action-started",
      at: MonotonicTimeMsSchema.parse(160),
      pageId: PAGE,
      actionId,
    });
    // A retried start capture of A returns after the action navigated to B.
    observe(205, '- heading "A again" [ref=e7]', { capturedForVisitId: a });
    lateB();
    session.recordActionCompleted({
      kind: "action-completed",
      at: MonotonicTimeMsSchema.parse(270),
      pageId: PAGE,
      actionId,
    });

    const evidence = await session.getActionEvidence(actionId);

    expect(headingOf(evidence.actionChange.structuralTree)).toBe("B");
  });

  it("takes a navigating action's after from its destination visit's capture even when that capture sorts before the visit's navigation", async () => {
    let now = 100;
    const session = new StructuralObservationSession({
      clock: { now: () => now },
    });
    const observe = (at: number, yaml: string, visitId: VisitId) => {
      const observedAt = MonotonicTimeMsSchema.parse(at);
      const tree = StructuralTree.fromAriaSnapshotYaml(
        yaml,
        new SyntheticAriaRefFactory()
      );
      session.recordObservation({
        kind: "observation",
        at: observedAt,
        pageId: PAGE,
        tree: {
          pageId: PAGE,
          capturedAt: observedAt,
          resolve: async () => tree,
        },
        capturedForVisitId: visitId,
      });
    };
    const a = session.recordNavigation({
      pageId: PAGE,
      url: "https://app.test/",
      cause: "initial",
    });
    if (a.kind !== "visit-started") throw new Error("Expected a visit.");
    observe(150, '- heading "A" [ref=e1]', a.visit.id);
    const actionId = StructuralActionIdSchema.parse("interaction_1");
    session.recordActionStarted({
      kind: "action-started",
      at: MonotonicTimeMsSchema.parse(160),
      pageId: PAGE,
      actionId,
    });
    now = 200;
    const b = session.prepareNavigation({
      pageId: PAGE,
      url: "https://app.test/b",
      cause: "navigate",
    });
    if (b.registration.kind !== "visit-started")
      throw new Error("Expected a visit.");
    // Captured at the navigation's own timestamp, before the navigation is committed.
    observe(200, '- heading "B" [ref=e2]', b.registration.visit.id);
    b.commit();
    session.recordActionCompleted({
      kind: "action-completed",
      at: MonotonicTimeMsSchema.parse(220),
      pageId: PAGE,
      actionId,
    });

    const evidence = await session.getActionEvidence(actionId);

    expect(headingOf(evidence.actionChange.structuralTree)).toBe("B");
  });

  // B has an action with no post-action capture, so its after is B's last observation once C opens.
  it.each(["never", "before", "while"] as const)(
    "reads an action with its visit's late capture, whether it was also read %s that capture arrived",
    async (earlierRead) => {
      const { session, b, observe } = racedSession({ tagged: true });
      observe(201, '- heading "B" [ref=e2]');
      const actionId = StructuralActionIdSchema.parse("interaction_1");
      session.recordActionStarted({
        kind: "action-started",
        at: MonotonicTimeMsSchema.parse(202),
        pageId: PAGE,
        actionId,
      });
      session.recordActionCompleted({
        kind: "action-completed",
        at: MonotonicTimeMsSchema.parse(203),
        pageId: PAGE,
        actionId,
      });
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const earlier =
        earlierRead === "never"
          ? Promise.resolve()
          : session.getActionEvidence(actionId, async (evidence) => {
              if (earlierRead === "while") await gate;
              return evidence.resolve();
            });
      if (earlierRead === "before") await earlier;
      observe(260, '- heading "B late" [ref=e8]', { capturedForVisitId: b });
      release();
      await earlier;

      const evidence = await session.getActionEvidence(actionId);

      expect(headingOf(evidence.actionChange.structuralTree)).toBe("B late");
    }
  );

  it("tells a visit with no observation apart from an unknown visit", async () => {
    const { session, b, c, lateB } = racedSession({ tagged: false });
    lateB();

    const missing = session.getVisitEvidence(b);
    await expect(missing).rejects.toBeInstanceOf(VisitWithoutObservationError);
    await expect(missing).rejects.toMatchObject({
      visitId: b,
      message: `No structural observation recorded for visit ${b}.`,
    });
    const unresolvable = session.getVisitEvidence(c, async () => {
      throw new Error("unparseable");
    });
    await expect(unresolvable).rejects.toMatchObject({
      name: "VisitWithoutObservationError",
      visitId: c,
      message: `No resolvable structural observation recorded for visit ${c}.`,
    });
    const unknown = session.getVisitEvidence(VisitIdSchema.parse("visit_99"));
    await expect(unknown).rejects.toThrow(
      "No recorded visit with id visit_99."
    );
    await expect(unknown).rejects.not.toBeInstanceOf(
      VisitWithoutObservationError
    );
  });
});
