import { describe, expect, it } from "vitest";

import { ayme } from "./decorators";
import {
  askPredicates,
  availabilityOf,
  combinedAvailability,
  type ObservedPomRoot,
  type PomInstanceObservation,
} from "./pomInstance";

// Unit tests: one Page Object instance's Action Availability (ADR-0035),
// from hand-written observations, without a page or a runtime. Elements are
// fakes that say whether they are on the page.

const element = (isConnected: boolean) => ({ isConnected }) as Element;
const connected = () => element(true);

const root = (overrides: Partial<ObservedPomRoot> = {}): ObservedPomRoot => ({
  element: connected(),
  present: true,
  available: true,
  obstruction: undefined,
  ...overrides,
});

const instance = (
  overrides: Partial<PomInstanceObservation> = {}
): PomInstanceObservation => ({
  path: "items[0]",
  componentPath: "items[]",
  item: undefined,
  root: root(),
  predicates: new Map(),
  ...overrides,
});

describe("one instance's availability", () => {
  it("is available on a present, reachable root without a predicate", () => {
    expect(availabilityOf(instance(), "archive")).toEqual({
      present: true,
      available: true,
    });
  });

  it("is absent while its root is not on the page, whatever its predicate said", () => {
    const predicates = new Map([["archive", { available: true }]]);
    for (const absent of [
      root({ present: false, available: false }),
      root({ element: undefined }),
      root({ element: element(false) }),
    ])
      expect(
        availabilityOf(instance({ root: absent, predicates }), "archive")
      ).toEqual({ present: false, available: false });
  });

  it("is obstructed while a click would not reach its root, before its predicate", () => {
    const predicates = new Map([
      ["archive", { available: false, reason: "Archived already" }],
    ]);
    expect(
      availabilityOf(
        instance({
          root: root({ available: false, obstruction: connected() }),
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

describe("asking an instance's predicates", () => {
  class Item {
    archive() {}
    rename() {}
    open() {}
  }
  const decorate = (
    methodName: keyof Item,
    available: () => boolean | string | Promise<boolean | string>
  ) =>
    ayme.action({ available })(
      Item.prototype,
      methodName,
      Object.getOwnPropertyDescriptor(Item.prototype, methodName)!
    );
  decorate("archive", () => "Archived already");
  decorate("rename", async () => {
    throw new Error("No name field");
  });
  const tool = (methodName: string) => ({
    methodName,
    toolName: methodName,
    parameters: [],
  });

  it("records each answer, a thrown error as the reason, and skips actions without one", async () => {
    const answers = await askPredicates(new Item(), [
      tool("archive"),
      tool("rename"),
      tool("open"),
    ]);
    expect([...answers]).toEqual([
      ["archive", { available: false, reason: "Archived already" }],
      ["rename", { available: false, reason: "No name field" }],
    ]);
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
