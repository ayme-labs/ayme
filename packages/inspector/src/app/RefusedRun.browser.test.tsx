import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import {
  callers,
  type Caller,
  type InspectorContract,
  type InspectorObserver,
  type InspectorState,
  type Run,
} from "@ayme-dev/ayme/inspector";

import { renderInspector } from "./renderInspector";
import {
  emptyInspectorState,
  replaceInspectorTransport,
} from "../shared/infrastructure";
import { Inspector } from "../../testing";

// Component tests: a Session's window whose Run the Session refuses before
// it starts, over a transport the test drives. Such a Run never reaches the
// page's Run log.

const DIALOG_OPEN =
  'A confirm dialog is open on the tab: "Remove Milk from the basket?". Answer it with your browser automation, then run this command again.';

const page = createPage();
const inspector = new Inspector(
  page,
  page.locator("[data-ayme-inspector-root]")
);
const unmounts: (() => void)[] = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  sessionStorage.clear();
});

const state: InspectorState = {
  ...emptyInspectorState,
  revision: 1,
  tools: [
    {
      name: "mark_element",
      agentDescription: "Mark one element on the page.",
      inputSchema: { type: "object" },
      group: "custom",
      available: true,
    },
  ],
};

/** A Session's transport that refuses every Run with `why`. */
function refusingTransport(why: string): InspectorContract {
  const never = () => new Promise<never>(() => {});
  return {
    getState: async () => state,
    subscribe: () => () => {},
    runTool: () => Promise.reject(new Error(why)),
    highlight: never,
    pick: never,
    cancelPick: never,
    look: never,
    recordedPageState: async () => undefined,
    demo: never,
    pomDefinitionText: async () => "",
  };
}

it("shows a Run the Session refused before it started as failed on its card, with why", async () => {
  replaceInspectorTransport(refusingTransport(DIALOG_OPEN), { external: true });
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInspector(host.attachShadow({ mode: "open" }), {
    windowed: true,
  });
  unmounts.push(() => {
    unmount();
    host.remove();
  });

  const card = await inspector.tool("mark_element");
  await card.run();

  await expect.poll(() => card.lastResult.textContent()).toContain("Failed");
  expect(await card.lastResult.textContent()).toContain(DIALOG_OPEN);
});

/**
 * A Session's transport whose Runs the test settles: each Run waits until
 * the test refuses it, and `list` gives the Session's Run log.
 */
function settledTransport() {
  let current = state;
  const observers = new Set<InspectorObserver>();
  const waiting: ((why: string) => void)[] = [];
  const never = () => new Promise<never>(() => {});
  const transport: InspectorContract = {
    getState: async () => current,
    subscribe(observer) {
      observers.add(observer);
      return () => void observers.delete(observer);
    },
    runTool: () =>
      new Promise((_, reject) => waiting.push((why) => reject(new Error(why)))),
    highlight: never,
    pick: never,
    cancelPick: never,
    look: never,
    recordedPageState: async () => undefined,
    demo: never,
    pomDefinitionText: async () => "",
  };
  return {
    transport,
    /** Refuses the oldest Run still waiting, with `why`. */
    refuse: (why = DIALOG_OPEN) => waiting.shift()!(why),
    list(runs: Run[]) {
      current = { ...current, revision: current.revision + 1, runs };
      for (const observer of [...observers])
        observer.onEvent({ type: "state", state: current });
    },
  };
}

/** Mounts the Inspector of a Session's window on `transport`. */
function mountOn(transport: InspectorContract) {
  replaceInspectorTransport(transport, { external: true });
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInspector(host.attachShadow({ mode: "open" }), {
    windowed: true,
  });
  unmounts.push(() => {
    unmount();
    host.remove();
  });
}

const logRun = (run: {
  id: string;
  tool: string;
  by?: Caller;
  startedAt?: number;
}): Run => ({
  by: callers.inspector,
  status: "running",
  startedAt: Date.now(),
  input: {},
  interactions: [],
  ...run,
});

it("leaves out a Run refused after Runs was cleared, which started before", async () => {
  const session = settledTransport();
  mountOn(session.transport);
  const card = await inspector.tool("mark_element");
  await card.run();
  session.refuse();
  await expect.poll(() => inspector.runs.header.textContent()).toBe("Runs · 1");

  await card.run();
  await inspector.runs.clear();
  session.refuse();
  await card.run();
  session.refuse("The tab closed.");

  await expect
    .poll(() => card.lastResult.textContent())
    .toContain("The tab closed.");
  expect(await inspector.runs.header.textContent()).toBe("Runs · 1");
});

it("shows a Run the Session's log listed once, when the Session's answer to it fails after", async () => {
  const session = settledTransport();
  mountOn(session.transport);
  const card = await inspector.tool("mark_element");
  await card.run();
  const listed = logRun({ id: "1", tool: "mark_element" });
  session.list([listed]);
  await expect.poll(() => inspector.runs.header.textContent()).toBe("Runs · 1");

  session.refuse();
  session.list([{ ...listed, status: "failed", error: "Gone." }]);
  await card.run();
  session.refuse("The tab closed.");

  await expect
    .poll(() => card.lastResult.textContent())
    .toContain("The tab closed.");
  expect(await inspector.runs.header.textContent()).toBe("Runs · 2");
});

it("shows a refused Run among the Session's logged Runs, newest first", async () => {
  const session = settledTransport();
  mountOn(session.transport);
  const card = await inspector.tool("mark_element");
  session.list([
    logRun({ id: "1", tool: "first_tool", by: "webmcp", startedAt: 1 }),
  ]);
  await card.run();
  session.refuse();
  if ((await inspector.runs.header.getAttribute("aria-expanded")) === "false")
    await inspector.runs.header.click();
  await inspector.runs.showAll();
  await expect.poll(() => inspector.runs.runs.count()).toBe(2);

  session.list([
    logRun({ id: "1", tool: "first_tool", by: "webmcp", startedAt: 1 }),
    logRun({ id: "2", tool: "last_tool", by: "webmcp" }),
  ]);

  await expect
    .poll(async () =>
      Promise.all(
        [0, 1, 2].map((index) =>
          inspector.runs.run(index).root.getAttribute("aria-label")
        )
      )
    )
    .toEqual(["last_tool", "mark_element", "first_tool"]);
  // It never started, so it performed nothing.
  const refused = inspector.runs.latest("mark_element");
  if ((await refused.toggle.getAttribute("aria-expanded")) === "false")
    await refused.toggle.click();
  await expect.poll(() => refused.error.textContent()).toContain(DIALOG_OPEN);
  expect(await refused.interactions.count()).toBe(0);
});
