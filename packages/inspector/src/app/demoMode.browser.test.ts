import { afterEach, expect, it, vi } from "vitest";
import { createAyme, type AymePage } from "@ayme-dev/ayme";
import { registerCompiledPom } from "@ayme-dev/ayme/internal";

import { mountInspector } from "./mountInspector";
import { getInspectorTrace } from "../runs";

// The Inspector's demo mode on a real page: an agent's call, run through the
// session's tools, pauses only while demo is on, and shows a click cue then
// for the actions that click.
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

const noInput = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

const manifest: Parameters<typeof registerCompiledPom>[1] = {
  className: "Toolbar",
  components: [],
  members: [],
  tools: (["go", "point", "tick", "key"] as const).map((methodName) => ({
    methodName,
    toolName: `Toolbar.${methodName}`,
    description: `${methodName}.`,
    inputSchema: noInput,
    parameters: [],
  })),
};

/** A tool call, the event it fires, the step Runs records and its cues. */
type Call = {
  tool: string;
  input: object;
  event: string;
  step: string;
  cues: number;
};

const calls: Call[] = [
  { tool: "Toolbar.go", input: {}, event: "click", step: "click", cues: 1 },
  {
    tool: "Toolbar.point",
    input: {},
    event: "mouseover",
    step: "hover",
    cues: 0,
  },
  { tool: "Toolbar.tick", input: {}, event: "change", step: "check", cues: 1 },
  {
    tool: "Toolbar.key",
    input: {},
    event: "keydown",
    step: "keyboard.press",
    cues: 0,
  },
  {
    tool: "press_key",
    input: { key: "a" },
    event: "keydown",
    step: "keyboard.press",
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
function callTool({ tool, input, event }: Call, { demo }: { demo: boolean }) {
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
  const runtime = createAyme();
  runtime.pom.register(Toolbar);
  const inspector = mountInspector({ demo });
  const stop = runtime.start();
  disposals.push(() => {
    stop();
    runtime.pom.unregister(Toolbar);
    inspector.dispose();
    observer.disconnect();
  });
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
  const { call: running, events, cues } = callTool(call, { demo });
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
    // The Runs view still records it.
    expect(getInspectorTrace().map(({ operation }) => operation)).toContain(
      call.step
    );
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
  const inspector = mountInspector({ demo: true });
  const runtime = createAyme();
  const stop = runtime.start();
  disposals.push(() => {
    stop();
    inspector.dispose();
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
