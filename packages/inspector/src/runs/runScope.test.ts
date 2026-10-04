import { expect, it } from "vitest";

import { indexMembers } from "../page-model/domain/memberIndex";
import { collection, page } from "../page-model/test-utils/pageModel";
import type { Run } from "../adapter/useRuns";
import { runScope as scopeOf } from "./runScope";

// Unit tests: which runs Runs shows for the selection. The runs are
// hand-written: one on the page's own action, one on an item of its list.

function run(id: number, extra: Partial<Run>): Run {
  return {
    id,
    toolName: "ListPage.addItem",
    className: "ListPage",
    objectPath: "ListPage",
    arguments: {},
    status: "succeeded",
    startedAt: 0,
    steps: [],
    ...extra,
  };
}

const addItem = run(1, {});
const archiveMilk = run(2, {
  toolName: "ListPage.items.archive",
  className: "ListItem",
  objectPath: "ListPage.items[1]",
  item: {
    path: "ListPage.items[1]",
    name: "[1]",
    pathBelowPage: "items[1]",
    ref: "e12",
    label: "Milk",
  },
  arguments: { ref: "e12", args: {} },
});
const runs = [archiveMilk, addItem];
const members = new Map([
  ["e1", ["ListPage"]],
  ["e10", ["ListPage.items[1]"]],
]);
const memberOf = (ref: string) => members.get(ref) ?? [];
const index = indexMembers({
  objects: [
    page("ListPage", {
      locators: ["addItemButton", "newItemInput"],
      children: [collection("items", "ListItem", [{}, {}])],
    }),
  ],
  models: [],
});
const runScope = (
  selection: Parameters<typeof scopeOf>[0],
  membersOf: typeof memberOf
) => scopeOf(selection, membersOf, (path) => index.within(path));

function shown(scope: ReturnType<typeof runScope>) {
  return runs.filter(scope.includes).map((shownRun) => shownRun.id);
}

it("shows every run on the page", () => {
  const scope = runScope({ kind: "page" }, memberOf);

  expect(scope.label).toBe("This page");
  expect(shown(scope)).toEqual([2, 1]);
});

it("shows the runs on a Page Object and on the objects inside it", () => {
  const page = runScope({ kind: "object", path: "ListPage" }, memberOf);
  const items = runScope({ kind: "object", path: "ListPage.items" }, memberOf);
  const otherItem = runScope(
    { kind: "object", path: "ListPage.items[0]" },
    memberOf
  );

  expect(page.label).toBe("This object");
  expect(shown(page)).toEqual([2, 1]);
  expect(shown(items)).toEqual([2]);
  expect(shown(otherItem)).toEqual([]);
});

it("shows the runs on a member, or whose steps acted on it", () => {
  const withStep = run(3, {
    steps: [
      {
        operation: "click",
        locator: "getByRole('button', { name: 'Add item' })",
        member: "ListPage.addItemButton",
      },
    ],
  });
  const onMember = (path: string) =>
    [archiveMilk, addItem, withStep]
      .filter(runScope({ kind: "member", path }, memberOf).includes)
      .map((shownRun) => shownRun.id);

  expect(onMember("ListPage.addItemButton")).toEqual([3]);
  expect(onMember("ListPage.items")).toEqual([2]);
  expect(onMember("ListPage.newItemInput")).toEqual([]);
});

it("shows the runs of a Page Object Model's actions", () => {
  expect(
    shown(runScope({ kind: "model", className: "ListItem" }, memberOf))
  ).toEqual([2]);
});

it("shows the runs on a structure node's ref or on the object it maps to", () => {
  expect(shown(runScope({ kind: "node", ref: "e12" }, memberOf))).toEqual([2]);
  expect(shown(runScope({ kind: "node", ref: "e10" }, memberOf))).toEqual([2]);
  expect(shown(runScope({ kind: "node", ref: "e99" }, memberOf))).toEqual([]);
});

it("shows a Browser Tool's run on the node its target names", () => {
  const fillMilk = run(4, {
    toolName: "fill",
    className: undefined,
    objectPath: undefined,
    arguments: { target: "e12", text: "Oat milk" },
  });

  expect(
    runScope({ kind: "node", ref: "e12" }, memberOf).includes(fillMilk)
  ).toBe(true);
});

it("shows a tool's runs", () => {
  const scope = runScope({ kind: "tool", name: "ListPage.addItem" }, memberOf);

  expect(scope.label).toBe("This tool");
  expect(shown(scope)).toEqual([1]);
});
