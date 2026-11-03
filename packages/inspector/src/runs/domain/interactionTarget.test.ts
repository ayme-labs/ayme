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

it("names a non-POM child by its own accessible identity, with its containing object as context", () => {
  expect(interactionTarget("e7", structure)).toEqual({
    target: 'button "Delete"',
    context: "ListPage.items[1]",
  });
});

it("identifies a root by its actual member and retains an unnamed element's direct text", () => {
  expect(interactionTarget("e3", structure).member).toBe("ListPage.items[1]");
  const unnamed = {
    ...button,
    name: "",
    children: [{ role: "text", name: "Archive", members: [], children: [] }],
  };
  expect(interactionTarget("e7", { roots: [unnamed], refCount: 1 })).toEqual({
    target: "button Archive",
  });
});

it("captures strings that remain readable when the source node changes or disappears", () => {
  const mutable = { ...button };
  const tree = { roots: [mutable], refCount: 1 };
  const captured = interactionTarget("e7", tree);
  mutable.name = "Removed";
  tree.roots.length = 0;
  expect(captured).toEqual({ target: 'button "Delete"' });
  expect(interactionTarget("e7", tree)).toEqual({});
});

it("leaves keyboard inputs and unknown refs without a made-up element", () => {
  expect(interactionTarget(undefined, structure)).toEqual({});
  expect(interactionTarget("e99", structure)).toEqual({});
});
