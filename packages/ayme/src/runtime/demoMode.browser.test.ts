import { afterEach, expect, it, vi } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";

import { probeRegisteredPomMembers } from "../page-objects/infrastructure";
import { registerCompiledPom } from "../page-objects/application";
import { createAyme, type AymePage } from "../index";

// The Inspector stays out of this test: its mount is replaced by a stand-in,
// so the session's own `inspector` demo is all that runs.
vi.mock("./inspector", () => ({
  loadInspector: async () => ({
    mountInspector: () => ({ dispose() {} }),
  }),
}));

// Demo mode on a real page: an agent's call, run through the session's tools,
// pauses only while demo is on, and shows a click cue then for the actions
// that click.
// setTimeout is fake, so the pause is measured in fake time, never
// wall-clock; animation frames stay real for the click's stability check.

class Toolbar {
  readonly keyboard: AymePage["keyboard"];
  constructor(readonly page: AymePage) {
    // Saved as the Toolbar is built, before the Inspector mounts.
    this.keyboard = page.keyboard;
  }
  async go() {
    await this.page.getByRole("button", { name: "Go" }).click();
  }
  async point() {
    await this.page.getByRole("button", { name: "Go" }).hover();
  }
  async tick() {
    await this.page.getByRole("checkbox").check();
  }
  async key() {
    await this.keyboard.press("a");
  }
}

const manifest: Parameters<typeof registerCompiledPom>[1] = {
  className: "Toolbar",
  components: [],
  members: [],
  tools: (["go", "point", "tick", "key"] as const).map((methodName) => ({
    methodName,
    toolName: `Toolbar.${methodName}`,
    description: `${methodName}.`,
    parameters: [],
  })),
};

/** A tool call, the event it fires and its cues. */
type Call = {
  tool: string;
  input: object;
  event: string;
  cues: number;
};

const calls: Call[] = [
  { tool: "Toolbar.go", input: {}, event: "click", cues: 1 },
  {
    tool: "Toolbar.point",
    input: {},
    event: "mouseover",

    cues: 0,
  },
  { tool: "Toolbar.tick", input: {}, event: "change", cues: 1 },
  {
    tool: "Toolbar.key",
    input: {},
    event: "keydown",

    cues: 0,
  },
  {
    tool: "press_key",
    input: { key: "a" },
    event: "keydown",

    cues: 0,
  },
];

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

/**
 * Builds the Toolbar, then mounts the Inspector, as on a page whose Inspector
 * loads late. Starts the session and makes `call` through its tools, the path
 * an agent's call takes.
 * Returns the call, and the events and click cues the page has seen so far.
 */
async function callTool(
  { tool, input, event }: Call,
  { demo }: { demo: boolean }
) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  document.body.innerHTML = `
    <button>Go</button>
    <label><input type="checkbox" /> Done</label>
    <input aria-label="Name" />
  `;
  // press_key presses on the element that has focus.
  document.querySelector<HTMLInputElement>("[aria-label=Name]")!.focus();
  let events = 0;
  let cues = 0;
  document.addEventListener(event, () => (events += 1), {
    capture: true,
    once: true,
  });
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof HTMLElement && "demoClickCue" in node.dataset)
          cues += 1;
  });
  observer.observe(document.body, { childList: true });
  registerCompiledPom(Toolbar, manifest);
  const runtime = createAyme(demo ? { inspector: { demo: true } } : {});
  runtime.pom.register(Toolbar);
  const stop = runtime.start();
  disposals.push(() => {
    stop();
    runtime.pom.unregister(Toolbar);
    observer.disconnect();
  });
  // The Toolbar lists its tools once the first observation has run.
  await probeRegisteredPomMembers();
  return {
    call: runtime.tools.run(tool as never, input as never),
    events: () => events,
    cues: () => cues,
  };
}

/**
 * Moves fake time in 10 ms steps, with a real animation frame after each,
 * until `done`. Returns how much fake time that took.
 */
async function pumpUntil(done: () => boolean) {
  let elapsed = 0;
  while (!done()) {
    if (elapsed >= 5_000) throw new Error("Still not done after 5 s.");
    await vi.advanceTimersByTimeAsync(10);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    elapsed += 10;
  }
  return elapsed;
}

/** Makes `call` to the end; returns the fake time until its event. */
async function untilActed(call: Call, demo: boolean) {
  const { call: running, events, cues } = await callTool(call, { demo });
  let settled = false;
  void running.finally(() => (settled = true));
  const elapsed = await pumpUntil(() => events() === 1);
  await pumpUntil(() => settled);
  await running;
  return { elapsed, cues: cues() };
}

it.each(calls)(
  "runs an agent's $tool without a pause or a click cue when demo is off",
  async (call) => {
    const { elapsed, cues } = await untilActed(call, false);

    expect(elapsed).toBeLessThan(500);
    expect(cues).toBe(0);
  }
);

it.each(calls)(
  "pauses before an agent's $tool when demo is on",
  async (call) => {
    const { elapsed, cues } = await untilActed(call, true);

    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(cues).toBe(call.cues);
  }
);

it("answers an agent's navigation once it settles when demo is on", async () => {
  document.body.innerHTML = "<main><h1>Start page</h1></main>";
  const start = location.href;
  const onHashChange = () =>
    document.querySelector("main")!.append(`Section ${location.hash}`);
  window.addEventListener("hashchange", onHashChange);
  const runtime = createAyme({ inspector: { demo: true } });
  const stop = runtime.start();
  disposals.push(() => {
    stop();
    window.removeEventListener("hashchange", onHashChange);
    history.replaceState(null, "", start);
  });
  await runtime.tools.run("snapshot", {});

  // Demo mode starts the navigation after its pause, past the quiet window
  // a settle waits for.
  await expect(
    runtime.tools.run("navigate", { url: "#details" })
  ).resolves.toEqual({
    page_changed: true,
    settled: true,
    changes: expect.stringContaining("Section #details"),
  });
});

/**
 * Demo mode's pause before each action, less a margin for the timer firing
 * early.
 */
const PAUSED = 450;

/** How long a key press on `page` takes, which demo mode pauses before. */
async function pressTime(page: AymePage) {
  const started = performance.now();
  await page.keyboard.press("Enter");
  return performance.now() - started;
}

it("instruments a supplied Page before constructing the first Page Object", async () => {
  class Model {
    constructor(readonly page: AymePage) {}
  }
  registerCompiledPom(Model, {
    className: "Model",
    components: [],
    members: [],
    tools: [],
  });
  const suppliedPage = createPage() as unknown as AymePage;
  const runtime = createAyme({
    inspector: { demo: true },
    pageFactory: () => suppliedPage,
  });
  disposals.push(runtime.start());
  const instance = runtime.pom.get(Model);

  expect(await pressTime(instance.page)).toBeGreaterThanOrEqual(PAUSED);
});

it("instruments the default Page before constructing the first Page Object", async () => {
  class DefaultModel {
    constructor(readonly page: AymePage) {}
  }
  registerCompiledPom(DefaultModel, {
    className: "DefaultModel",
    components: [],
    members: [],
    tools: [],
  });
  const runtime = createAyme({ inspector: { demo: true } });
  disposals.push(runtime.start());
  const instance = runtime.pom.get(DefaultModel);

  expect(await pressTime(instance.page)).toBeGreaterThanOrEqual(PAUSED);
});

it("stops pacing when the session stops and resumes once after a restart", async () => {
  class DisposableModel {
    constructor(readonly page: AymePage) {}
  }
  registerCompiledPom(DisposableModel, {
    className: "DisposableModel",
    components: [],
    members: [],
    tools: [],
  });
  const runtime = createAyme({ inspector: { demo: true } });
  let stop = runtime.start();
  disposals.push(() => stop());
  const instance = runtime.pom.get(DisposableModel);
  expect(await pressTime(instance.page)).toBeGreaterThanOrEqual(PAUSED);

  stop();
  expect(await pressTime(instance.page)).toBeLessThan(PAUSED);

  stop = runtime.start();
  const restarted = await pressTime(instance.page);
  expect(restarted).toBeGreaterThanOrEqual(PAUSED);
  // Once: a second wrapper would pause again.
  expect(restarted).toBeLessThan(2 * PAUSED);
});
