import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";
import { createAyme, type AymePage } from "@ayme-dev/ayme";
import { capturePageState, registerCompiledPom } from "@ayme-dev/ayme/internal";

import { installInspectorInstrumentation, mountInspector } from "./index";
import { inspectorShadowRoot } from "./shared";

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.innerHTML = "";
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
  disposals.push(installInspectorInstrumentation({ demo: true }));
  const suppliedPage = createPage();
  class Model {
    constructor(readonly page: AymePage) {}
  }
  registerCompiledPom(Model, {
    className: "Model",
    components: [],
    members: [],
    tools: [],
  });

  const runtime = createAyme({ pageFactory: () => suppliedPage });
  const instance = runtime.pom.get(Model);

  expect(await pressTime(instance.page)).toBeGreaterThanOrEqual(PAUSED);
});

it("instruments the default Page before constructing the first Page Object", async () => {
  disposals.push(installInspectorInstrumentation({ demo: true }));
  class DefaultModel {
    constructor(readonly page: AymePage) {}
  }
  registerCompiledPom(DefaultModel, {
    className: "DefaultModel",
    components: [],
    members: [],
    tools: [],
  });

  const runtime = createAyme();
  const instance = runtime.pom.get(DefaultModel);

  expect(await pressTime(instance.page)).toBeGreaterThanOrEqual(PAUSED);
});

it("stops pacing during disposal and resumes once after remount", async () => {
  const dispose = installInspectorInstrumentation({ demo: true });
  disposals.push(dispose);
  class DisposableModel {
    constructor(readonly page: AymePage) {}
  }
  registerCompiledPom(DisposableModel, {
    className: "DisposableModel",
    components: [],
    members: [],
    tools: [],
  });
  const instance = createAyme().pom.get(DisposableModel);
  expect(await pressTime(instance.page)).toBeGreaterThanOrEqual(PAUSED);

  dispose();
  expect(await pressTime(instance.page)).toBeLessThan(PAUSED);

  disposals.push(installInspectorInstrumentation({ demo: true }));
  const remounted = await pressTime(instance.page);
  expect(remounted).toBeGreaterThanOrEqual(PAUSED);
  // Once: a second wrapper would pause again.
  expect(remounted).toBeLessThan(2 * PAUSED);
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

it("owns consumer highlight styling for the mounted Inspector", () => {
  const first = mountInspector();
  const duplicate = mountInspector();
  const style = document.head.querySelector(
    "style[data-ayme-inspector-highlight-style]"
  );

  expect(
    document.head.querySelectorAll("style[data-ayme-inspector-highlight-style]")
  ).toHaveLength(1);
  expect(style?.textContent).toContain("[data-ayme-highlight]");

  duplicate.dispose();
  expect(style?.isConnected).toBe(true);
  first.dispose();
  expect(style?.isConnected).toBe(false);
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
  // Only the page highlight style reaches the host document.
  expect(
    document.head.querySelectorAll("style, link[rel=stylesheet]")
  ).toHaveLength(headStylesBefore + 1);

  inspector.dispose();
  expect(shadowRoot?.childNodes).toHaveLength(0);
});

it("excludes the Inspector UI from structural page-state capture", async () => {
  document.body.innerHTML = "<main><h1>Consumer application</h1></main>";
  const inspector = mountInspector();
  await Promise.resolve();

  const state = await capturePageState(document.body);

  expect(state).toContain("Consumer application");
  // The panel is titled and labelled "ayme"; the host page never says it.
  expect(state).not.toContain("ayme");
  inspector.dispose();
});
