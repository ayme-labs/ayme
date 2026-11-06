import { afterEach, expect, it, vi } from "vitest";

import { createPage } from "@ayme-dev/playwright-lite";
import { createAyme, type AymePage, type AymeOptions } from "@ayme-dev/ayme";

import { mountInspector } from "./index";
import { inspectorShadowRoot } from "./shared";

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.innerHTML = "";
});

it("mounts one Inspector in a closed Shadow Root and supports disposal and remount", async () => {
  const first = mountInspector();
  const duplicate = mountInspector();
  await Promise.resolve();

  const host = document.body.querySelector("[data-ayme-inspector-host]");
  expect(
    document.body.querySelectorAll("[data-ayme-inspector-host]")
  ).toHaveLength(1);
  expect(host?.tagName).toBe("AYME-INSPECTOR");
  // Closed: the host page cannot reach it; tests use the test-only hook.
  expect(host?.shadowRoot).toBeNull();
  expect(inspectorShadowRoot(host!)?.mode).toBe("closed");

  duplicate.dispose();
  expect(host?.isConnected).toBe(true);
  first.dispose();
  expect(host?.isConnected).toBe(false);

  const remounted = mountInspector();
  await Promise.resolve();
  expect(
    document.body.querySelectorAll("[data-ayme-inspector-host]")
  ).toHaveLength(1);
  remounted.dispose();
});

it("renders the React Inspector and its stylesheet inside the Shadow Root only", () => {
  const headStylesBefore = document.head.querySelectorAll(
    "style, link[rel=stylesheet]"
  ).length;
  const inspector = mountInspector();
  const shadowRoot = inspectorShadowRoot(
    document.body.querySelector("[data-ayme-inspector-host]")!
  );

  expect(
    shadowRoot?.querySelector('aside[aria-label="ayme"] h2')?.textContent
  ).toBe("ayme");
  const style = shadowRoot?.querySelector("style[data-ayme-inspector-style]");
  expect(style?.textContent).toContain("--background");
  expect(style?.textContent).toContain(":host");
  expect(
    shadowRoot?.querySelector(
      "[data-ayme-inspector-root] [data-ayme-inspector-portal]"
    )
  ).not.toBeNull();
  // No style reaches the host document: highlights are Playwright's overlay.
  expect(
    document.head.querySelectorAll("style, link[rel=stylesheet]")
  ).toHaveLength(headStylesBefore);

  inspector.dispose();
  expect(shadowRoot?.childNodes).toHaveLength(0);
});

// The Inspector asks the runtime for Demo Mode; the runtime paces its Pages.

/** Demo mode's pause before each action. */
const PAUSE_MS = 500;

type Session = ReturnType<typeof startSession>;

/** How many demo pauses an agent's key press through `session` waits for. */
async function pausesOfKeyPress(session: Session) {
  const timers = vi.spyOn(globalThis, "setTimeout");
  try {
    await session.tools.run("press_key", { key: "Enter" });
    return timers.mock.calls.filter(([, delay]) => delay === PAUSE_MS).length;
  } finally {
    timers.mockRestore();
  }
}

/** A started session over a Page the test supplies. */
function startSession(options: AymeOptions = {}) {
  const runtime = createAyme({
    pageFactory: () => createPage() as unknown as AymePage,
    ...options,
  });
  disposals.push(runtime.start());
  return runtime;
}

it("paces a started session's Page while the Inspector is mounted with demo", async () => {
  disposals.push(mountInspector({ demo: true }).dispose);
  const runtime = startSession();

  expect(await pausesOfKeyPress(runtime)).toBe(1);
});

it("paces a session started before the Inspector is mounted, until it is disposed", async () => {
  const runtime = startSession();
  expect(await pausesOfKeyPress(runtime)).toBe(0);

  const mounted = mountInspector({ demo: true });
  disposals.push(mounted.dispose);
  expect(await pausesOfKeyPress(runtime)).toBe(1);
  mounted.dispose();
  expect(await pausesOfKeyPress(runtime)).toBe(0);
});

it("stops pacing during disposal and resumes once after remount", async () => {
  const mounted = mountInspector({ demo: true });
  disposals.push(mounted.dispose);
  const runtime = startSession();
  expect(await pausesOfKeyPress(runtime)).toBe(1);

  mounted.dispose();
  expect(await pausesOfKeyPress(runtime)).toBe(0);

  disposals.push(mountInspector({ demo: true }).dispose);
  // Once: a second wrapper would pause again.
  expect(await pausesOfKeyPress(runtime)).toBe(1);
});

it("excludes the Inspector UI from structural page-state capture", async () => {
  document.body.innerHTML = "<main><h1>Consumer application</h1></main>";
  const inspector = mountInspector();
  disposals.push(inspector.dispose);
  await Promise.resolve();
  const runtime = startSession();

  const state = JSON.stringify(await runtime.tools.run("snapshot", {}));

  expect(state).toContain("Consumer application");
  // The panel is titled and labelled "ayme"; the host page never says it.
  expect(state).not.toContain("ayme");
});
