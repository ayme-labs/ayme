import { expect, it } from "vitest";

import type { StructureNode } from "../../structure";
import { interactionTarget } from "./interactionTarget";

const button: StructureNode = {
  ref: "e7",
  role: "button",
  name: "Delete",
  members: [],
  children: [],
};
const item: StructureNode = {
  ref: "e3",
  role: "listitem",
  name: "",
  member: "ListPage.items[1]",
  owner: "ListPage.items[1]",
  members: ["ListPage.items[1]"],
  children: [button],
};
const structure = { roots: [item], refCount: 2 };

it("keeps a non-POM child's containing object as context without claiming its root was acted on", () => {
  expect(interactionTarget("e7", structure)).toEqual({
    context: "ListPage.items[1]",
  });
});

it("identifies a root by its actual member", () => {
  expect(interactionTarget("e3", structure).member).toBe("ListPage.items[1]");
});

it("captures strings that remain readable when the source node changes or disappears", () => {
  const mutable = { ...item };
  const tree = { roots: [mutable], refCount: 1 };
  const captured = interactionTarget("e3", tree);
  mutable.member = "ListPage.items[2]";
  tree.roots.length = 0;
  expect(captured).toEqual({ member: "ListPage.items[1]" });
  expect(interactionTarget("e3", tree)).toEqual({});
});

it("leaves keyboard inputs and unknown refs without a made-up element", () => {
  expect(interactionTarget(undefined, structure)).toEqual({});
  expect(interactionTarget("e99", structure)).toEqual({});
});
