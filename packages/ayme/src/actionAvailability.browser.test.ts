import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";

import { ayme as agent, runContext } from "./agentCalls.testSupport";
import type { PomManifest, ToolManifest } from "./contracts";
import { ayme } from "./decorators";
import { createPage } from "./browserPage";
import { buildToolOptions } from "./goalLoopQuestions";
import { configurePageStateIgnore } from "./pageState";
import { listTools } from "./publishedTools";
import {
  createPageRegistration,
  listAvailablePomTools,
  listRegisteredPomTools,
  probeRegisteredPomMembers,
  registerCompiledPom,
  subscribeToRegisteredPoms,
} from "./registry";
import { createAyme, type Ayme } from "./runtime";

// Observation and publication seam (ADR-0035): a real Page Object with an
// availability predicate, observed on a real page, and what the published
// tool list, a call and the Goal Loop's offer say about its actions.

const action = (methodName: string, toolName: string): ToolManifest => ({
  methodName,
  toolName,
  description: methodName,
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  parameters: [],
});
const root = { memberName: "root", kind: "locator", access: "field" } as const;

/** Applies `@ayme.action({ available })` to `methodName` of `Class`, legacy mode. */
function withAvailability(
  Class: { prototype: object },
  methodName: string,
  available: (self: never) => boolean | string | Promise<boolean | string>
) {
  ayme.action({ available })(
    Class.prototype,
    methodName,
    Object.getOwnPropertyDescriptor(Class.prototype, methodName)!
  );
}

const listed = (name: string) =>
  listRegisteredPomTools().find(({ tool }) => tool.name === name);
const published = (name: string) =>
  listTools({ peeks: false }).find((tool) => tool.name === name);

describe("Action Availability", () => {
  let page: Page;
  let session: Ayme;
  let stopSession: () => void;
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    page = createPage();
    session = createAyme({ pageFactory: () => page });
    stopSession = session.start();
  });
  afterEach(() => {
    stopSession();
    configurePageStateIgnore(undefined);
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
  });

  it.each([
    ["a sync true", () => true, { available: true }],
    ["a sync false", () => false, { available: false }],
    [
      "a sync string",
      () => "No item is selected",
      { available: false, reason: "No item is selected" },
    ],
    ["an async true", async () => true, { available: true }],
    ["an async false", async () => false, { available: false }],
    [
      "an async string",
      async () => "Nothing to remove",
      { available: false, reason: "Nothing to remove" },
    ],
    // An empty string is no reason.
    ["an empty string", () => "", { available: false }],
  ])(
    "lists the action of a present Page Object with what %s predicate answers",
    async (_label, predicate, expected) => {
      document.body.innerHTML = '<section id="panel">Panel</section>';
      class Panel {
        root = page.locator("#panel");
        remove() {}
      }
      withAvailability(Panel, "remove", predicate);
      registerCompiledPom(Panel, {
        className: "Panel",
        members: [root],
        tools: [action("remove", "Panel.remove")],
        components: [],
      });
      createPageRegistration(Panel);
      await probeRegisteredPomMembers();

      expect(listed("Panel.remove")).toMatchObject({
        present: true,
        ...expected,
      });
      expect(published("Panel.remove")).toMatchObject(expected);
      // The Goal Loop offers available tools only.
      const offered = buildToolOptions().map((option) => option.key);
      if (expected.available) {
        expect(offered).toContain("Panel.remove");
      } else {
        expect(offered).not.toContain("Panel.remove");
        expect(listAvailablePomTools().map((tool) => tool.name)).toEqual([]);
        if (!("reason" in expected))
          expect(published("Panel.remove")).not.toHaveProperty("reason");
        // The refusal carries the reason, or ends without one.
        await expect(session.tools.run("Panel.remove", {})).rejects.toThrow(
          "reason" in expected
            ? `Panel.remove is unavailable: ${expected.reason}.`
            : "Panel.remove is unavailable."
        );
      }
    }
  );

  it("judges each action by its own predicate, and refuses by the Page Object the tool belongs to", async () => {
    document.body.innerHTML =
      '<section id="toolbar">Toolbar</section><section id="panel">Panel</section>';
    class Toolbar {
      root = page.locator("#toolbar");
      reset() {}
    }
    class Panel {
      root = page.locator("#panel");
      removed = 0;
      remove() {
        this.removed += 1;
      }
      duplicate() {}
    }
    withAvailability(Panel, "remove", () => "No item is selected");
    withAvailability(Panel, "duplicate", () => true);
    registerCompiledPom(Toolbar, {
      className: "Toolbar",
      members: [root],
      tools: [action("reset", "Toolbar.reset")],
      components: [],
    });
    registerCompiledPom(Panel, {
      className: "Panel",
      members: [root],
      tools: [
        action("remove", "Panel.remove"),
        action("duplicate", "Panel.duplicate"),
      ],
      components: [],
    });
    createPageRegistration(Toolbar);
    const registration = createPageRegistration(Panel);
    await probeRegisteredPomMembers();

    expect(published("Toolbar.reset")).toMatchObject({ available: true });
    expect(published("Panel.remove")).toMatchObject({
      available: false,
      reason: "No item is selected",
    });
    expect(published("Panel.duplicate")).toMatchObject({ available: true });
    await expect(session.tools.run("Panel.remove", {})).rejects.toThrow(
      "Panel.remove is unavailable: No item is selected."
    );
    expect(registration.instance.removed).toBe(0);
    await session.tools.run("Panel.duplicate", {});
  });

  it("judges a page-level action by the page's own root, not by its components' roots", async () => {
    document.body.innerHTML =
      '<section id="shell">Shell <div id="panel">Panel</div></section>';
    class Shell {
      root = page.locator("#shell");
      panel = { root: page.locator("#panel"), close() {} };
      archive() {}
    }
    withAvailability(Shell, "archive", () => "Nothing is selected");
    registerCompiledPom(Shell, {
      className: "Shell",
      members: [
        root,
        {
          memberName: "panel",
          kind: "component",
          access: "field",
          componentClassName: "Panel",
          collection: false,
        },
      ],
      tools: [action("archive", "Shell.archive")],
      components: [
        {
          className: "Panel",
          members: [root],
          tools: [action("close", "Shell.panel.close")],
        },
      ],
    });
    createPageRegistration(Shell);
    await probeRegisteredPomMembers();

    expect(published("Shell.panel.close")).toMatchObject({ available: true });
    expect(published("Shell.archive")).toMatchObject({
      available: false,
      reason: "Nothing is selected",
    });
  });

  it("hands the predicate the live Page Object and wires one predicate to several actions", async () => {
    document.body.innerHTML =
      '<section id="panel">Panel <button id="remove" hidden>Remove</button></section>';
    const seen: object[] = [];
    class Panel {
      root = page.locator("#panel");
      removeButton = page.locator("#remove");
      remove() {}
      duplicate() {}
    }
    const canRemove = async (self: Panel) => {
      seen.push(self);
      return (
        (await self.removeButton.isVisible()) ||
        "This dashboard is built in or the last of its type"
      );
    };
    withAvailability(Panel, "remove", canRemove);
    withAvailability(Panel, "duplicate", canRemove);
    registerCompiledPom(Panel, {
      className: "Panel",
      members: [
        root,
        { memberName: "removeButton", kind: "locator", access: "field" },
      ],
      tools: [
        action("remove", "Panel.remove"),
        action("duplicate", "Panel.duplicate"),
      ],
      components: [],
    });
    const registration = createPageRegistration(Panel);
    await probeRegisteredPomMembers();

    expect(seen).toEqual([registration.instance, registration.instance]);
    for (const name of ["Panel.remove", "Panel.duplicate"])
      expect(published(name)).toMatchObject({
        available: false,
        reason: "This dashboard is built in or the last of its type",
      });

    document.querySelector("#remove")!.removeAttribute("hidden");
    await probeRegisteredPomMembers();
    for (const name of ["Panel.remove", "Panel.duplicate"])
      expect(published(name)).toMatchObject({ available: true });
    expect(published("Panel.remove")).not.toHaveProperty("reason");
  });

  it("judges a collection action per instance, offers it while one instance passes, and refuses the call on one that does not", async () => {
    document.body.innerHTML =
      '<nav id="toolbar">Toolbar</nav><ul><li id="draft" data-state="draft">Draft</li><li id="sent" data-state="sent">Sent</li></ul>';
    // Another Page Object, registered first, owns none of the items.
    class Toolbar {
      root = page.locator("#toolbar");
      reset() {}
    }
    registerCompiledPom(Toolbar, {
      className: "Toolbar",
      members: [root],
      tools: [action("reset", "Toolbar.reset")],
      components: [],
    });
    createPageRegistration(Toolbar);
    class Item {
      constructor(readonly root: ReturnType<Page["locator"]>) {}
      recall() {
        document.querySelector("#sent")!.setAttribute("data-state", "recalled");
      }
    }
    const judged: Item[] = [];
    const canRecall = async (self: Item) => {
      judged.push(self);
      return (
        (await self.root.getAttribute("data-state")) === "sent" ||
        "Only a sent item can be recalled"
      );
    };
    withAvailability(Item, "recall", canRecall);
    class Outbox {
      items = [
        new Item(page.locator("#draft")),
        new Item(page.locator("#sent")),
        // Not on the page: never judged.
        new Item(page.locator("#deleted")),
      ];
    }
    registerCompiledPom(Outbox, {
      className: "Outbox",
      members: [
        {
          memberName: "items",
          kind: "component",
          access: "field",
          componentClassName: "Item",
          collection: true,
        },
      ],
      tools: [],
      components: [
        {
          className: "Item",
          members: [root],
          tools: [action("recall", "Outbox.items.recall")],
        },
      ],
    } satisfies PomManifest);
    const registration = createPageRegistration(Outbox);
    await probeRegisteredPomMembers();
    expect(judged).toContain(registration.instance.items[0]);
    expect(judged).toContain(registration.instance.items[1]);
    expect(judged).not.toContain(registration.instance.items[2]);
    const state = await agent.getPageState();
    const refOf = (index: number) =>
      state.text.match(new RegExp(`(e\\d+) Outbox\\.items\\[${index}\\]`))?.[1];
    const draft = refOf(0);
    const sent = refOf(1);
    if (!draft || !sent) throw new Error("Expected refs for both items.");

    expect(published("Outbox.items.recall")).toMatchObject({ available: true });
    expect(published("Outbox.items.recall")).not.toHaveProperty("reason");
    const { tool } = listed("Outbox.items.recall")!;
    await expect(
      tool.execute({ ref: draft, args: {} }, runContext())
    ).rejects.toThrow(
      "Outbox.items.recall is unavailable: Only a sent item can be recalled."
    );
    expect(document.querySelector("#sent")!.getAttribute("data-state")).toBe(
      "sent"
    );
    await tool.execute({ ref: sent, args: {} }, runContext());
    expect(document.querySelector("#sent")!.getAttribute("data-state")).toBe(
      "recalled"
    );

    await probeRegisteredPomMembers();
    expect(published("Outbox.items.recall")).toMatchObject({
      available: false,
      reason: "Only a sent item can be recalled",
    });
  });

  it("names the Structural Ref of what is in the way: an overlay, a native modal, an inert ancestor", async () => {
    // The overlay's pane and the holder's cover have no ref of their own: the
    // reason names the overlay, the nearest ancestor with one, and nothing
    // for the cover, whose only such ancestor holds the root.
    document.body.innerHTML = `
      <div id="wrapper"><section id="covered" style="height:40px">Covered</section></div>
      <div id="inertWrapper" role="group" aria-label="Frozen"><section id="frozen" style="height:40px">Frozen</section></div>
      <div id="holder" role="region" aria-label="Holder" style="position:relative"><section id="held" style="height:40px">Held</section><div id="cover" style="position:absolute;inset:0"></div></div>
      <section id="blocked" style="height:40px">Blocked</section>
      <div id="overlay" role="dialog" aria-label="Cookie settings" style="position:absolute;left:0;top:0;width:100%;height:40px"><div id="pane" style="height:100%"></div></div>
      <dialog id="modal" aria-label="Archive item"><button>Confirm</button></dialog>
      <div role="region" aria-label="Dialogs"><dialog id="quiet" aria-hidden="true"><button>Confirm</button></dialog></div>`;
    class Shell {
      covered = { root: page.locator("#covered"), close() {} };
      frozen = { root: page.locator("#frozen"), close() {} };
      held = { root: page.locator("#held"), close() {} };
      blocked = { root: page.locator("#blocked"), close() {} };
    }
    const child = (memberName: string) =>
      ({
        memberName,
        kind: "component",
        access: "field",
        componentClassName: "Panel",
        collection: false,
      }) as const;
    registerCompiledPom(Shell, {
      className: "Shell",
      members: [
        child("covered"),
        child("frozen"),
        child("held"),
        child("blocked"),
      ],
      tools: [],
      components: [
        {
          className: "Panel",
          members: [root],
          tools: [action("close", "close")],
        },
      ],
    });
    createPageRegistration(Shell);
    document.querySelector("#inertWrapper")!.setAttribute("inert", "");
    // The agent's page state gives the elements in the way their refs.
    const { text } = await agent.getPageState();
    const refOf = (pattern: string) =>
      text.match(new RegExp(`(e\\d+) ${pattern}`))?.[1];
    const overlay = refOf('dialog "Cookie settings"');
    const frozen = refOf('group "Frozen"');
    expect(overlay).toBeDefined();
    expect(frozen).toBeDefined();

    expect(published("Shell.covered.close")).toMatchObject({
      available: false,
      reason: `a click would not reach it; ${overlay} is in the way`,
    });
    expect(published("Shell.frozen.close")).toMatchObject({
      available: false,
      reason: `a click would not reach it; ${frozen} is in the way`,
    });
    expect(published("Shell.held.close")).toMatchObject({
      available: false,
      reason: "a click would not reach it",
    });
    expect(published("Shell.blocked.close")).toMatchObject({ available: true });

    document.querySelector<HTMLDialogElement>("#modal")!.showModal();
    // Until the agent's page state shows the modal, nothing names it: the
    // reason never falls back to an element around it.
    await probeRegisteredPomMembers();
    expect(published("Shell.blocked.close")).toMatchObject({
      available: false,
      reason: "a click would not reach it",
    });
    // The page state that gives the modal its ref changes the listing, so
    // the registry's subscribers hear of it.
    const changes = vi.fn();
    const unsubscribe = subscribeToRegisteredPoms(changes);
    const after = await agent.getPageState();
    expect(changes).toHaveBeenCalled();
    unsubscribe();
    const modal = after.text.match(/(e\d+) dialog "Archive item"/)?.[1];
    expect(modal).toBeDefined();
    expect(published("Shell.blocked.close")).toMatchObject({
      available: false,
      reason: `a click would not reach it; ${modal} is in the way`,
    });

    // A modal the page state leaves out is named by its own ref only, never
    // by the region around it.
    document.querySelector<HTMLDialogElement>("#modal")!.close();
    document.querySelector<HTMLDialogElement>("#quiet")!.showModal();
    configurePageStateIgnore((element) => element.id === "quiet");
    const { text: quiet } = await agent.getPageState();
    expect(quiet).toMatch(/e\d+ region "Dialogs"/);
    expect(quiet).not.toContain('dialog "Confirm"');
    expect(published("Shell.blocked.close")).toMatchObject({
      available: false,
      reason: "a click would not reach it",
    });
  });

  it("gives the reason without a ref when nothing in the way has one", async () => {
    document.body.innerHTML =
      '<section id="panel" style="height:40px"><button>Act</button></section>';
    document.body.style.pointerEvents = "none";
    class Panel {
      root = page.locator("#panel");
      act() {}
    }
    registerCompiledPom(Panel, {
      className: "Panel",
      members: [root],
      tools: [action("act", "Panel.act")],
      components: [],
    });
    createPageRegistration(Panel);
    await agent.getPageState();

    expect(published("Panel.act")).toMatchObject({
      available: false,
      reason: "a click would not reach it",
    });
  });

  it("names the element over the root's centre when several are in the way", async () => {
    document.body.innerHTML = `
      <section id="panel" style="position:absolute;left:0;top:0;width:300px;height:100px"><button>Act</button></section>
      <div role="banner" aria-label="Top" style="position:absolute;left:0;top:0;width:300px;height:20px"></div>
      <div role="dialog" aria-label="Middle" style="position:absolute;left:0;top:20px;width:300px;height:80px"></div>`;
    class Panel {
      root = page.locator("#panel");
      act() {}
    }
    registerCompiledPom(Panel, {
      className: "Panel",
      members: [root],
      tools: [action("act", "Panel.act")],
      components: [],
    });
    createPageRegistration(Panel);
    const { text } = await agent.getPageState();
    const middle = text.match(/(e\d+) dialog "Middle"/)?.[1];
    expect(middle).toBeDefined();

    expect(published("Panel.act")).toMatchObject({
      available: false,
      reason: `a click would not reach it; ${middle} is in the way`,
    });
  });

  it("withdraws the tools of a Page Object that is not on the page, whatever its predicates say", async () => {
    document.body.innerHTML = '<section id="panel" hidden>Panel</section>';
    class Panel {
      root = page.locator("#panel");
      remove() {}
    }
    const predicate = vi.fn(() => true);
    withAvailability(Panel, "remove", predicate);
    registerCompiledPom(Panel, {
      className: "Panel",
      members: [root],
      tools: [action("remove", "Panel.remove")],
      components: [],
    });
    createPageRegistration(Panel);
    await probeRegisteredPomMembers();

    expect(listed("Panel.remove")).toMatchObject({
      present: false,
      available: false,
    });
    expect(published("Panel.remove")).toBeUndefined();
    // A predicate is asked only about a Page Object that is on the page.
    expect(predicate).not.toHaveBeenCalled();

    document.querySelector("#panel")!.removeAttribute("hidden");
    await probeRegisteredPomMembers();
    expect(published("Panel.remove")).toMatchObject({ available: true });
    expect(predicate).toHaveBeenCalled();
  });

  it("decides a call by the last observation, never by running the predicate with the call", async () => {
    document.body.innerHTML = '<section id="panel">Panel</section>';
    let verdict: boolean | string = true;
    class Panel {
      root = page.locator("#panel");
      removed = 0;
      remove() {
        this.removed += 1;
      }
    }
    withAvailability(Panel, "remove", () => verdict);
    registerCompiledPom(Panel, {
      className: "Panel",
      members: [root],
      tools: [action("remove", "Panel.remove")],
      components: [],
    });
    const registration = createPageRegistration(Panel);
    await probeRegisteredPomMembers();
    expect(published("Panel.remove")).toMatchObject({ available: true });
    // A page state changes nothing about an available tool's listing, so
    // the registry's subscribers hear nothing.
    const changes = vi.fn();
    const unsubscribe = subscribeToRegisteredPoms(changes);
    await agent.getPageState();
    expect(changes).not.toHaveBeenCalled();
    unsubscribe();

    // The page did not change, so no observation ran between the predicate
    // changing its mind and the call: the call goes by the last observation.
    verdict = "Nothing is selected";
    await listed("Panel.remove")!.tool.execute({}, runContext());
    expect(registration.instance.removed).toBe(1);

    await probeRegisteredPomMembers();
    expect(published("Panel.remove")).toMatchObject({
      available: false,
      reason: "Nothing is selected",
    });
  });

  it("makes an action whose predicate throws unavailable, with the error as its reason", async () => {
    document.body.innerHTML = '<section id="panel">Panel</section>';
    class Panel {
      root = page.locator("#panel");
      remove() {}
    }
    withAvailability(Panel, "remove", () => {
      throw new TypeError("store is undefined");
    });
    registerCompiledPom(Panel, {
      className: "Panel",
      members: [root],
      tools: [action("remove", "Panel.remove")],
      components: [],
    });
    createPageRegistration(Panel);
    await probeRegisteredPomMembers();

    expect(published("Panel.remove")).toMatchObject({
      available: false,
      reason: "TypeError: store is undefined",
    });
  });

  it("applies a predicate to a Page Object without a declared root", async () => {
    class Rootless {
      open() {}
    }
    withAvailability(Rootless, "open", () => "Not yet");
    registerCompiledPom(Rootless, {
      className: "Rootless",
      members: [],
      tools: [action("open", "Rootless.open")],
      components: [],
    });
    createPageRegistration(Rootless);
    await probeRegisteredPomMembers();

    expect(published("Rootless.open")).toMatchObject({
      available: false,
      reason: "Not yet",
    });
  });
});
