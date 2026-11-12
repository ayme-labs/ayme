import { describe, expect, it, vi } from "vitest";
import type { PageObjectId, PageObjectTreeNode } from "../page-objects/domain";
import type { ToolInfo } from "../shared";
import {
  pageObjectToolSource,
  type PageObjectToolSession,
} from "./pageObjectToolSource";

// The answer an agent gets from a Page Object Tool, through WebMCP and
// through `ayme mcp` alike, from a stand-in session.

const tool = (name: string, group: ToolInfo["group"]): ToolInfo => ({
  name,
  inputSchema: { type: "object" },
  group,
  available: true,
});

const TOOLS = [
  tool("snapshot", "agent"),
  tool("page_objects", "agent"),
  tool("click", "browser"),
  tool("Item.archive", "pageObject"),
  tool("ListPage.add", "pageObject"),
];

const list = (...names: string[]): PageObjectTreeNode => ({
  className: "ListPage",
  children: [
    {
      kind: "objects",
      name: "items",
      objects: names.map((name, index) => ({
        className: "Item",
        id: `po${index + 1}` as PageObjectId,
        children: [
          { kind: "elements", name: "name", lines: [`text: ${name}`] },
        ],
      })),
    },
  ],
});

/**
 * A session whose page shows `trees` one after the other, a read at a
 * time, at `urls` one after the other, and whose runs answer `answer`.
 */
function session({
  trees = [[list("Milk")]],
  urls = ["http://app/list"],
  answer,
}: {
  trees?: PageObjectTreeNode[][];
  urls?: string[];
  answer: () => Promise<unknown>;
}) {
  let read = 0;
  let at = 0;
  const run = vi.fn<PageObjectToolSession["run"]>(() => answer());
  const stub: PageObjectToolSession = {
    list: () => TOOLS,
    subscribe: () => () => {},
    run,
    readPageObjectTree: async () => trees[Math.min(read++, trees.length - 1)]!,
    url: () => urls[Math.min(at++, urls.length - 1)]!,
  };
  return { stub, run };
}

const FULL_RECORD = {
  settled: true,
  page_changed: true,
  changes_before: "- paragraph: toast",
  changes: "- listitem: Eggs",
};

describe("a Page Object Tool's answer to an agent", () => {
  it("lists the Page Object Tools and page_objects, and no other tool", () => {
    const { stub } = session({ answer: async () => FULL_RECORD });
    expect(
      pageObjectToolSource(stub)
        .list()
        .map(({ name }) => name)
    ).toEqual(["page_objects", "Item.archive", "ListPage.add"]);
  });

  it("is whether the page settled and what the action returned, without the Change Record", async () => {
    const { stub, run } = session({
      answer: async () => ({ ...FULL_RECORD, result: { count: 2 } }),
    });

    const answer = await pageObjectToolSource(stub).run("ListPage.add", {
      args: { name: "Eggs" },
    });

    expect(answer).toEqual({ settled: true, result: { count: 2 } });
    expect(run).toHaveBeenCalledExactlyOnceWith("ListPage.add", {
      args: { name: "Eggs" },
    });
  });

  it("carries the URL only when the action changed it", async () => {
    const { stub } = session({
      urls: ["http://app/list", "http://app/item/1"],
      answer: async () => FULL_RECORD,
    });

    expect(await pageObjectToolSource(stub).run("ListPage.add", {})).toEqual({
      settled: true,
      url: "http://app/item/1",
    });
  });

  it("says the document is loading, with the URL it loads, and reads no tree of the old document", async () => {
    const readPageObjectTree = vi.fn(async () => [list("Milk")]);
    const { stub } = session({
      answer: async () => ({
        settled: false,
        page_changed: false,
        loading: "http://app/item/1",
        next: "The page is loading http://app/item/1. Call snapshot next to read the new page.",
      }),
    });

    const answer = await pageObjectToolSource({
      ...stub,
      readPageObjectTree,
    }).run("ListPage.add", {});

    expect(answer).toEqual({
      settled: false,
      url: "http://app/item/1",
      loading: true,
    });
    expect(readPageObjectTree).toHaveBeenCalledOnce();
  });

  it("carries the change in the Page Object Tree, a Page Object that appeared in full with its children and id", async () => {
    const { stub } = session({
      trees: [[list("Milk")], [list("Milk", "Eggs")]],
      answer: async () => FULL_RECORD,
    });

    expect(await pageObjectToolSource(stub).run("ListPage.add", {})).toEqual({
      settled: true,
      changes: [
        "ListPage",
        "  items:",
        "    + Item po2",
        "        name: text: Eggs",
      ].join("\n"),
    });
  });

  it("refuses with the reason alone", async () => {
    const refusal = new Error("Item.archive is unavailable: it is archived.");
    const { stub } = session({
      answer: () => Promise.reject(refusal),
    });

    const error = await pageObjectToolSource(stub)
      .run("Item.archive", { id: "po1" })
      .catch((caught: unknown) => caught);

    expect(error).toBe(refusal);
    expect({ ...(error as object) }).toEqual({});
  });

  it("fails with what failed alone, without the Change Record the session left on it", async () => {
    const failure = Object.assign(new Error("Timeout 5000ms exceeded."), {
      page_changed: true,
      changes_before: "- paragraph: toast",
      changes: "- dialog",
    });
    const { stub } = session({ answer: () => Promise.reject(failure) });

    const error = await pageObjectToolSource(stub)
      .run("ListPage.add", {})
      .catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect((error as Error).message).toBe("Timeout 5000ms exceeded.");
    expect({ ...(error as object) }).toEqual({});
  });

  it("leaves every other tool's answer as the session gives it", async () => {
    const failure = Object.assign(new Error("No element."), {
      page_changed: true,
      changes: "- dialog",
    });
    const { stub } = session({ answer: async () => FULL_RECORD });
    const source = pageObjectToolSource(stub);

    expect(await source.run("click", {})).toBe(FULL_RECORD);
    stub.run = () => Promise.reject(failure);
    await expect(source.run("click", {})).rejects.toMatchObject({
      changes: "- dialog",
    });
  });

  it("answers page_objects with the session's text", async () => {
    const { stub } = session({ answer: async () => "ListPage" });
    expect(await pageObjectToolSource(stub).run("page_objects", {})).toBe(
      "ListPage"
    );
  });
});
