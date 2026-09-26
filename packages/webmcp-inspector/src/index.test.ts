import { afterEach, expect, it } from "vitest";
import { createPage } from "@ayme-dev/playwright-lite";
import { createRuntimeSession, type AymePage } from "@ayme-dev/webmcp";
import {
  capturePageState,
  registerCompiledPom,
} from "@ayme-dev/webmcp/internal";

import {
  getInspectorTrace,
  installInspectorInstrumentation,
  mountInspector,
} from "./index";
import { withDemoFeedback } from "./demo";

const disposals: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.innerHTML = "";
});

it("instruments a supplied Page before constructing the first Page Object", async () => {
  document.body.innerHTML = "<button>Run</button>";
  disposals.push(installInspectorInstrumentation());
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

  const runtime = createRuntimeSession({ page: () => suppliedPage });
  const instance = runtime.construct(Model);
  await instance.page
    .getByRole("button", { name: "Run" })
    .waitFor({ state: "attached" });

  expect(getInspectorTrace()).toEqual([
    {
      operation: "waitFor",
      locator: "getByRole('button', { name: 'Run' })",
      state: "attached",
    },
  ]);
});

it("instruments the default Page before constructing the first Page Object", async () => {
  document.body.innerHTML = "<button>Default</button>";
  disposals.push(installInspectorInstrumentation());
  class DefaultModel {
    constructor(readonly page: AymePage) {}
  }
  registerCompiledPom(DefaultModel, {
    className: "DefaultModel",
    components: [],
    members: [],
    tools: [],
  });

  const runtime = createRuntimeSession();
  const instance = runtime.construct(DefaultModel);
  await instance.page
    .getByRole("button", { name: "Default" })
    .waitFor({ state: "attached" });

  expect(getInspectorTrace()).toHaveLength(1);
});

it("adds Inspector tracing to an existing feedback Page without double instrumentation", async () => {
  document.body.innerHTML = "<button>Shared</button>";
  const demoTrace: unknown[] = [];
  const page = withDemoFeedback(createPage(), {
    onTrace(entry) {
      demoTrace.push(entry);
    },
  });
  disposals.push(installInspectorInstrumentation());
  class SharedModel {
    constructor(readonly page: AymePage) {}
  }
  registerCompiledPom(SharedModel, {
    className: "SharedModel",
    components: [],
    members: [],
    tools: [],
  });

  const instance = createRuntimeSession({ page: () => page }).construct(
    SharedModel
  );
  await instance.page
    .getByRole("button", { name: "Shared" })
    .waitFor({ state: "attached" });

  expect(demoTrace).toHaveLength(1);
  expect(getInspectorTrace()).toHaveLength(1);
});

it("stops tracing during disposal and resumes once after remount", async () => {
  document.body.innerHTML = "<button>Stop</button>";
  const dispose = installInspectorInstrumentation();
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
  const instance = createRuntimeSession().construct(DisposableModel);

  await instance.page
    .getByRole("button", { name: "Stop" })
    .waitFor({ state: "attached" });
  expect(getInspectorTrace()).toHaveLength(1);

  dispose();
  await instance.page
    .getByRole("button", { name: "Stop" })
    .waitFor({ state: "attached" });

  expect(getInspectorTrace()).toHaveLength(1);

  const remountDispose = installInspectorInstrumentation();
  disposals.push(remountDispose);
  await instance.page
    .getByRole("button", { name: "Stop" })
    .waitFor({ state: "attached" });

  expect(getInspectorTrace()).toHaveLength(1);
});

it("mounts one Inspector in an ordinary open Shadow Root and supports disposal and remount", async () => {
  const first = mountInspector();
  const duplicate = mountInspector();
  await Promise.resolve();

  const host = document.body.querySelector("[data-ayme-inspector-host]");
  expect(
    document.body.querySelectorAll("[data-ayme-inspector-host]")
  ).toHaveLength(1);
  expect(host?.tagName).toBe("DIV");
  expect(host?.shadowRoot?.mode).toBe("open");

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
  const shadowRoot = document.body.querySelector(
    "[data-ayme-inspector-host]"
  )?.shadowRoot;

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
  expect(state).not.toContain("Inspector");
  inspector.dispose();
});
