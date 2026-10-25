import { afterEach, expect, it } from "vitest";

import { registerCompiledPom, probeRegisteredPomMembers } from "./registry";
import { createPage } from "./browserPage";
import { rooted } from "../../test-utils/pomRoot.testSupport";
import { rootRef } from "../../test-utils/agentCalls.testSupport";
import { startSession } from "../../test-utils/session.testSupport";
import { callers, type PomManifest } from "../../shared";

afterEach(() => {
  document.body.innerHTML = "";
});

it("publishes one class tool across member paths and registrations and calls each root", async () => {
  document.body.innerHTML =
    '<button id="a">A</button><button id="b">B</button><button id="c">C</button>';
  const page = createPage();
  const session = startSession(page);
  const called: string[] = [];
  const item = (id: string) =>
    rooted(page.locator(`#${id}`), {
      open() {
        called.push(id);
      },
    });
  class FirstPage {
    first = item("a");
    second = item("b");
  }
  class SecondPage {
    third = item("c");
  }
  const manifest = (className: string, members: string[]): PomManifest => ({
    className,
    tools: [],
    members: members.map((memberName) => ({
      memberName,
      kind: "component",
      access: "field",
      componentClassName: "Item",
      collection: false,
    })),
    components: [
      {
        className: "Item",
        members: [],
        tools: [{ methodName: "open", toolName: "Item.open", parameters: [] }],
      },
    ],
  });
  registerCompiledPom(FirstPage, manifest("FirstPage", ["first", "second"]));
  registerCompiledPom(SecondPage, manifest("SecondPage", ["third"]));
  try {
    session.register(FirstPage);
    session.register(SecondPage);
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools
        .list()
        .filter((t) => t.group === "pageObject")
        .map((t) => t.name)
    ).toEqual(["Item.open"]);
    for (const path of [
      "FirstPage.first",
      "FirstPage.second",
      "SecondPage.third",
    ])
      await session.ayme.tools.run(
        "Item.open",
        { ref: await rootRef(path) },
        { by: callers.webmcp }
      );
    expect(called).toEqual(["a", "b", "c"]);
    expect(
      session.ayme.runs.list().filter((run) => run.tool === "Item.open")
    ).toHaveLength(3);
  } finally {
    session.stop();
  }
});

it("offers and calls every recursive instance, coalescing members on the same root", async () => {
  document.body.innerHTML =
    '<section id="outer">Outer<button id="inner">Inner</button></section>';
  const page = createPage();
  const session = startSession(page);
  const called: string[] = [];
  const inner = rooted(page.locator("#inner"), {
    open() {
      called.push("inner");
    },
  });
  Object.assign(inner, { child: inner });
  const outer = rooted(page.locator("#outer"), {
    child: inner,
    open() {
      called.push("outer");
    },
  });
  class TreePage {
    node = outer;
    alias = rooted(page.locator("#inner"), {
      child: inner,
      open() {
        called.push("alias");
      },
    });
  }
  const child = (memberName: string) => ({
    memberName,
    kind: "component" as const,
    access: "field" as const,
    componentClassName: "Node",
    collection: false,
  });
  registerCompiledPom(TreePage, {
    className: "TreePage",
    members: [child("node"), child("alias")],
    tools: [],
    components: [
      {
        className: "Node",
        members: [child("child")],
        tools: [{ methodName: "open", toolName: "Node.open", parameters: [] }],
      },
    ],
  });
  try {
    session.register(TreePage);
    await probeRegisteredPomMembers();
    const { buildToolOptions } = await import("../../goal-loop");
    const offered = buildToolOptions(page).find(
      ({ key }) => key === "Node.open"
    )!.tool.args[0]!.closedSet;
    expect(offered).toMatchObject({
      kind: "instance",
      roots: [{ label: "Node" }, { label: "Node" }],
    });
    const ref = await rootRef("TreePage.node.child");
    await session.ayme.tools.run("Node.open", { ref }, { by: callers.webmcp });
    expect(called).toEqual(["inner"]);
    document.querySelector("#inner")!.remove();
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools.list().some(({ name }) => name === "Node.open")
    ).toBe(true);
    document.querySelector("#outer")!.remove();
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools.list().some(({ name }) => name === "Node.open")
    ).toBe(false);
  } finally {
    session.stop();
  }
});
