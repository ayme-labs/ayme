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
import { VisitIdSchema } from "./Visit";

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

  it("reads an observation recorded before an action like any other, and never takes it as the action's after", async () => {
    const { session, observe, startAction, completeAction } =
      recordingSession();
    session.recordNavigation({
      pageId: PAGE,
      url: "https://example.test/",
      cause: "initial",
    });
    observe('- button "Save" [ref=e1]');
    const actionId = StructuralActionIdSchema.parse("interaction_1");
    const before = observe(
      '- button "Save" [ref=e1]\n- status "Draft" [ref=e2]',
      {
        capturedForActionId: actionId,
        relation: "before",
      }
    );
    expect(startAction("interaction_1")).toBe(actionId);
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
