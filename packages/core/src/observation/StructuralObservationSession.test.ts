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
});
