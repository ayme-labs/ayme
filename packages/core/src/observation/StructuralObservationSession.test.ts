import { describe, expect, it } from "vitest";
import { MonotonicTimeMsSchema } from "../capture/MonotonicTimeMs";
import { PageIdSchema } from "../capture/PageId";
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
