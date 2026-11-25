import { describe, expect, it } from "vitest";

import {
  availabilityOf,
  combinedAvailability,
  type ObservedPomRoot,
  type PomInstanceObservation,
} from "./pomInstance";
import { assertAvailable } from "../../page-state/domain";

// Unit tests: one Page Object instance's Action Availability (ADR-0062),
// from hand-written observations, without a page or a runtime.

let minted = 0;
const element = () => `s_${++minted}`;

const root = (overrides: Partial<ObservedPomRoot> = {}): ObservedPomRoot => ({
  ref: element(),
  present: true,
  available: true,
  ...overrides,
});

const instance = (
  overrides: Partial<PomInstanceObservation> = {}
): PomInstanceObservation => {
  const observedRoot = "root" in overrides ? overrides.root : root();
  return {
    path: "items[0]",
    instance: {},
    className: "Item",
    present: observedRoot?.present ?? true,
    root: observedRoot,
    predicates: new Map(),
    ...overrides,
  };
};

describe("one instance's availability", () => {
  it("is available on a present, reachable root without a predicate", () => {
    expect(availabilityOf(instance(), "archive")).toEqual({
      present: true,
      available: true,
    });
  });

  it("is absent while its root is not on the page, whatever its predicate said", () => {
    const predicates = new Map([["archive", { available: true }]]);
    expect(
      availabilityOf(
        instance({
          root: root({ ref: undefined, present: false, available: false }),
          predicates,
        }),
        "archive"
      )
    ).toEqual({ present: false, available: false });
  });

  it("is obstructed while a click would not reach its root, before its predicate", () => {
    const predicates = new Map([
      ["archive", { available: false, reason: "Archived already" }],
    ]);
    expect(
      availabilityOf(
        instance({
          root: root({ available: false }),
          predicates,
        }),
        "archive"
      )
    ).toEqual({
      present: true,
      available: false,
      reason: "a click would not reach it",
    });
  });

  it("names what is in the way by the role and name the probe gave it", () => {
    const obstructed = instance({
      root: root({ available: false, inTheWay: 'dialog "Delete"' }),
    });

    expect(availabilityOf(obstructed, "archive")).toEqual({
      present: true,
      available: false,
      reason: 'a click would not reach it; dialog "Delete" is in the way',
    });
  });

  it("takes its predicate's answer and reason, per action", () => {
    const observed = instance({
      predicates: new Map([
        ["archive", { available: false, reason: "Archived already" }],
        ["rename", { available: false }],
        ["open", { available: true }],
      ]),
    });
    expect(availabilityOf(observed, "archive")).toEqual({
      present: true,
      available: false,
      reason: "Archived already",
    });
    expect(availabilityOf(observed, "rename")).toEqual({
      present: true,
      available: false,
      reason: undefined,
    });
    expect(availabilityOf(observed, "open")).toMatchObject({
      available: true,
    });
  });

  it("is always present for a Page Object without a declared root", () => {
    expect(availabilityOf(instance({ root: undefined }), "open")).toEqual({
      present: true,
      available: true,
    });
  });
});

describe("a tool's availability over its instances", () => {
  it("is available while any instance is, else the first present one's reason", () => {
    const absent = { present: false, available: false };
    const blocked = { present: true, available: false, reason: "Busy" };
    expect(
      combinedAvailability([
        absent,
        blocked,
        { present: true, available: true },
      ])
    ).toEqual({ present: true, available: true });
    expect(combinedAvailability([absent, blocked])).toEqual(blocked);
    expect(combinedAvailability([absent])).toEqual(absent);
    expect(combinedAvailability([])).toEqual(absent);
  });
});

describe("refusing an unavailable tool's call", () => {
  // The whole message: `toThrow(string)` would accept a trailing "?." too.
  const refusal = (availability: Parameters<typeof assertAvailable>[1]) => {
    try {
      assertAvailable("Panel.remove", availability);
    } catch (error) {
      return (error as Error).message;
    }
    return undefined;
  };

  it.each([
    ["Busy", "Panel.remove is unavailable: Busy."],
    ["Not ready.", "Panel.remove is unavailable: Not ready."],
    ["Signed in?", "Panel.remove is unavailable: Signed in?"],
    ["Stop!", "Panel.remove is unavailable: Stop!"],
  ])("closes the reason %j as a sentence once", (reason, message) => {
    expect(refusal({ present: true, available: false, reason })).toBe(message);
  });

  it("ends without a reason when there is none", () => {
    expect(refusal({ present: true, available: false })).toBe(
      "Panel.remove is unavailable."
    );
    expect(refusal({ present: false, available: false })).toBe(
      "Panel.remove is unavailable: its Page Object is not on the page."
    );
  });
});
