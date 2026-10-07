import { expect, it } from "vitest";

import { indexMembers } from "../../page-model";
import { collection, page } from "../../page-model/test-utils/pageModel";
import { anItem, aRun, aStep } from "../test-utils/runs";
import { runScope as scopeOf } from "./runScope";

// Unit tests: which runs Runs shows for the selection. The runs are one on
// the page's own action and one on an item of its list.

const addItem = aRun({ id: "1" });
const archiveMilk = aRun({
  id: "2",
  toolName: "ListPage.items.archive",
  className: "ListItem",
  item: anItem("ListPage.items[1]", { ref: "e12", label: "Milk" }),
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
  expect(shown(scope)).toEqual(["2", "1"]);
});

it("shows the runs on a Page Object and on the objects inside it", () => {
  const page = runScope({ kind: "object", path: "ListPage" }, memberOf);
  const items = runScope({ kind: "object", path: "ListPage.items" }, memberOf);
  const otherItem = runScope(
    { kind: "object", path: "ListPage.items[0]" },
    memberOf
  );

  expect(page.label).toBe("This object");
  expect(shown(page)).toEqual(["2", "1"]);
  expect(shown(items)).toEqual(["2"]);
  expect(shown(otherItem)).toEqual([]);
});

it("shows the runs on a member, or whose steps acted on it", () => {
  const withStep = aRun({
    id: "3",
    steps: [aStep({ member: "ListPage.addItemButton" })],
  });
  const onMember = (path: string) =>
    [archiveMilk, addItem, withStep]
      .filter(runScope({ kind: "member", path }, memberOf).includes)
      .map((shownRun) => shownRun.id);

  expect(onMember("ListPage.addItemButton")).toEqual(["3"]);
  expect(onMember("ListPage.items")).toEqual(["2"]);
  expect(onMember("ListPage.newItemInput")).toEqual([]);
});

it("shows the runs of a Page Object Model's actions", () => {
  expect(
    shown(runScope({ kind: "model", className: "ListItem" }, memberOf))
  ).toEqual(["2"]);
});

it("shows the runs on a structure node's ref or on the object it maps to", () => {
  expect(shown(runScope({ kind: "node", ref: "e12" }, memberOf))).toEqual([
    "2",
  ]);
  expect(shown(runScope({ kind: "node", ref: "e10" }, memberOf))).toEqual([
    "2",
  ]);
  expect(shown(runScope({ kind: "node", ref: "e99" }, memberOf))).toEqual([]);
});

it("shows a Browser Tool's run on the node its target names", () => {
  const fillMilk = aRun({
    toolName: "fill",
    arguments: { target: "e12", text: "Oat milk" },
  });

  expect(
    runScope({ kind: "node", ref: "e12" }, memberOf).includes(fillMilk)
  ).toBe(true);
});

it("leaves a run from before the page loaded off a node its old refs named", () => {
  const fillMilk = aRun({
    toolName: "fill",
    arguments: { target: "e12", text: "Oat milk" },
    earlierDocument: true,
  });
  const archiveMilkBefore = { ...archiveMilk, earlierDocument: true as const };

  expect(
    runScope({ kind: "node", ref: "e12" }, memberOf).includes(fillMilk)
  ).toBe(false);
  expect(
    runScope({ kind: "node", ref: "e10" }, memberOf).includes(archiveMilkBefore)
  ).toBe(true);
});

it("shows a tool's runs", () => {
  const scope = runScope({ kind: "tool", name: "ListPage.addItem" }, memberOf);

  expect(scope.label).toBe("This tool");
  expect(shown(scope)).toEqual(["1"]);
});
