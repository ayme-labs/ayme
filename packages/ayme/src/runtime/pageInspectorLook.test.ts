import {
  StructuralTree,
  SyntheticAriaRefFactory,
} from "@ayme-dev/core/structural-observation";
import { afterEach, expect, it, vi } from "vitest";

import type { PageStateLook } from "../page-state/domain";
import {
  lookAtInspectorStateOf,
  recordedPageStateOf,
  registeredPageObjects,
  registeredPomDefinitions,
  type LookSources,
} from "./pageInspectorLook";

/** A page whose Structural Page State names `e1` and `e2`. */
const tree = StructuralTree.fromAriaSnapshotYaml(
  ['- button "Add" [ref=e1]', '- textbox "Name" [ref=e2]'].join("\n"),
  new SyntheticAriaRefFactory()
);
const state = {
  tree,
  text: "",
  projected: { roots: [] },
} as unknown as PageStateLook;

/** A look's sources over `state`, with the registry's answers `registry` gives. */
function sources(
  registry: Partial<{
    targets: Awaited<
      ReturnType<LookSources["registry"]["listRegisteredPomTargets"]>
    >;
    rooted: Awaited<
      ReturnType<LookSources["registry"]["listRootedToolInstances"]>
    >;
    elementToolTargets: ReadonlyMap<string, readonly string[]>;
  }>
): LookSources {
  return {
    look: async () => state,
    registry: {
      listRegisteredPomTargets: async () => registry.targets ?? [],
      listRootedToolInstances: async () => registry.rooted ?? new Map(),
    },
    elementToolTargets: async () => registry.elementToolTargets ?? new Map(),
    controls: async () => ({}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("names a target's element by its ref only when the look holds that ref, and keeps its aliases", async () => {
  const look = await lookAtInspectorStateOf(
    sources({
      targets: [
        { path: "Cart.add", locator: "button", ref: "e1", aliases: ["plus"] },
        { path: "Cart.gone", locator: "#gone", ref: "e9" },
      ] as never,
    })
  );

  expect(look.targets).toStrictEqual([
    { path: "Cart.add", locator: "button", aliases: ["plus"], ref: "e1" },
    { path: "Cart.gone", locator: "#gone" },
  ]);
  expect(look.targetsByRef).toStrictEqual({ e1: ["Cart.add"] });
});

it("lists the paths of every target whose element is one ref under that ref", async () => {
  const look = await lookAtInspectorStateOf(
    sources({
      targets: [
        { path: "Cart", locator: "form", ref: "e2" },
        { path: "Cart.name", locator: "input", ref: "e2" },
      ] as never,
    })
  );

  expect(look.targetsByRef).toStrictEqual({ e2: ["Cart", "Cart.name"] });
});

it("names a rooted tool's item by its Page Object id, its root's ref when the look holds it, and why it is unavailable", async () => {
  const look = await lookAtInspectorStateOf(
    sources({
      rooted: new Map([
        [
          "Card.open",
          [
            { id: "card-1", ref: "e1", available: true },
            { id: "card-2", ref: "e9", available: false, reason: "Closed" },
          ],
        ],
      ]) as never,
    })
  );

  expect(look.rootedInstances).toStrictEqual({
    "Card.open": [
      { id: "card-1", ref: "e1", available: true },
      { id: "card-2", available: false, reason: "Closed" },
    ],
  });
});

it("hands over each Custom Tool's targets and the look's refs as plain lists", async () => {
  const look = await lookAtInspectorStateOf(
    sources({ elementToolTargets: new Map([["fill", ["e2"]]]) })
  );

  expect(look.elementToolTargets).toStrictEqual({ fill: ["e2"] });
  expect(look.refs).toEqual(["e1", "e2"]);
});

it("has no recorded page state before the Host recorded one, and the refs of the one it recorded", () => {
  expect(recordedPageStateOf(undefined)).toBeUndefined();
  expect(recordedPageStateOf({ tree })?.refs).toEqual(["e1", "e2"]);
});

it("hands over each registered Page Object's sets as lists", () => {
  const [pageObject] = registeredPageObjects({
    listRegisteredPoms: () =>
      [
        {
          id: "cart-1",
          manifest: { className: "Cart" },
          memberObservations: [],
          presentPaths: new Set(["Cart"]),
          rootMemberPaths: new Set(["Cart.root"]),
          tools: [],
        },
      ] as never,
  });

  expect(pageObject).toStrictEqual({
    id: "cart-1",
    manifest: { className: "Cart" },
    memberObservations: [],
    presentPaths: ["Cart"],
    rootMemberPaths: ["Cart.root"],
    tools: [],
  });
});

it("has no Page Object Model definitions when they cannot be read, and warns why", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const definitions = registeredPomDefinitions({
    listRegisteredPoms: () => {
      throw new Error("Two classes are named Cart.");
    },
  } as never);

  expect(definitions).toEqual([]);
  expect(warn).toHaveBeenCalledWith(
    "Could not read the page object models: Two classes are named Cart."
  );
});
