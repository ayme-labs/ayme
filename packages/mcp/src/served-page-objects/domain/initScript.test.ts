import { expect, it, vi } from "vitest";

import { initScript } from "./servedPageObjects";

/** A deferred import the test settles. */
type Pending = {
  url: string;
  resolve(module: unknown): void;
  reject(error: Error): void;
};

/**
 * Runs the init script in a top-level page of `https://app.test`, with the
 * runtime, the modules it imports and the stamp socket the test drives. The
 * document has loaded unless `loading`, and `slot` is what its global holds
 * where a browser runtime publishes its Inspector contract.
 */
function runInitScript({
  loading = false,
  slot,
  webMCP,
}: {
  loading?: boolean;
  slot?: { contract?: object };
  webMCP?: boolean;
} = {}) {
  const options: Record<string, unknown>[] = [];
  const imports: Pending[] = [];
  const registered: string[] = [];
  const sockets: { onmessage?: (event: { data: string }) => void }[] = [];
  const reload = vi.fn();
  const errors: unknown[] = [];
  const pom = {
    register(model: { name: string; fails?: boolean }) {
      if (model.fails) throw new Error(`${model.name} failed`);
      registered.push(model.name);
    },
    unregister(model: { name: string }) {
      registered.splice(registered.indexOf(model.name), 1);
    },
  };
  const createAyme = (given: { pageObjects: { name: string }[] }) => {
    options.push(given);
    const { pageObjects } = given;
    registered.push(...pageObjects.map((model) => model.name));
    return { start() {}, pom };
  };
  const loadListeners: (() => void)[] = [];
  const window: Record<PropertyKey, unknown> = {
    document: { readyState: loading ? "interactive" : "complete" },
    addEventListener(type: string, listener: () => void) {
      if (type === "load") loadListeners.push(listener);
    },
    // The page is idle at once.
    requestIdleCallback: (callback: () => void) => callback(),
    [Symbol.for("ayme.inspectorContract")]: slot,
  };
  window.top = window;
  const script = initScript(
    4720,
    webMCP === undefined ? undefined : { webMCP }
  ).replaceAll("import(", "importModule(");
  new Function(
    "window",
    "location",
    "WebSocket",
    "importModule",
    "console",
    "setTimeout",
    script
  )(
    window,
    { protocol: "https:", origin: "https://app.test", reload },
    class {
      constructor() {
        sockets.push(this);
      }
    },
    (url: string) =>
      new Promise((resolve, reject) => imports.push({ url, resolve, reject })),
    { error: (...args: unknown[]) => errors.push(args) },
    () => {}
  );
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    imports,
    sockets,
    load() {
      for (const listener of loadListeners) listener();
    },
    registered,
    reload,
    errors,
    settle,
    stamp(entry: string, runtime = "r1") {
      sockets.at(-1)!.onmessage!({ data: JSON.stringify({ entry, runtime }) });
    },
    async answer(url: RegExp, module: unknown) {
      const pending = imports.find((i) => url.test(i.url))!;
      imports.splice(imports.indexOf(pending), 1);
      pending.resolve(module);
      await settle();
    },
    createAyme,
    options,
  };
}

const entry = (...names: (string | { name: string; fails: true })[]) => ({
  default: names.map((name) => (typeof name === "string" ? { name } : name)),
});

async function started(webMCP?: boolean) {
  const page = runInitScript({ webMCP });
  page.stamp("e1");
  await page.answer(/runtime\.js\?build=r1$/, { createAyme: page.createAyme });
  await page.answer(/entry\.js\?build=e1$/, entry("A"));
  return page;
}

it("loads the build of the first stamp it is told of", async () => {
  const page = await started();

  expect(page.registered).toEqual(["A"]);
});

it("starts the runtime with its Agent Connection and WebMCP publication off", async () => {
  const page = await started();

  expect(page.options).toEqual([
    expect.objectContaining({ agentConnection: true }),
  ]);
  expect(page.options[0]).not.toHaveProperty("webMCP");
});

it("starts the runtime with WebMCP publication on with webMCP", async () => {
  const page = await started(true);

  expect(page.options).toEqual([
    expect.objectContaining({
      agentConnection: true,
      webMCP: { enabled: true },
    }),
  ]);
});

it("swaps in the newest rebuild, not one that finishes loading after it", async () => {
  const page = await started();

  page.stamp("e2");
  page.stamp("e3");
  await page.answer(/entry\.js\?build=e2$/, entry("B"));
  await page.answer(/entry\.js\?build=e3$/, entry("C"));

  expect(page.registered).toEqual(["C"]);
  expect(page.imports).toEqual([]);
});

it("loads a rebuild again on its next stamp when its import failed", async () => {
  const page = await started();

  page.stamp("e2");
  page.imports.shift()!.reject(new Error("offline"));
  await page.settle();
  page.stamp("e2");
  await page.answer(/entry\.js\?build=e2$/, entry("B"));

  expect(page.registered).toEqual(["B"]);
});

it("keeps the old Page Objects when registering a rebuild's fails", async () => {
  const page = await started();

  page.stamp("e2");
  await page.answer(
    /entry\.js\?build=e2$/,
    entry("B", { name: "C", fails: true })
  );
  expect(page.errors).toHaveLength(1);
  expect(page.registered).toEqual(["A"]);

  page.stamp("e3");
  await page.answer(/entry\.js\?build=e3$/, entry("D"));

  expect(page.registered).toEqual(["D"]);
});

it("reloads the page after a rebuild of the runtime", async () => {
  const page = await started();

  page.stamp("e2", "r2");
  await page.settle();

  expect(page.reload).toHaveBeenCalled();
});

it("follows the stamps only once the document has loaded", () => {
  const page = runInitScript({ loading: true });
  expect(page.sockets).toHaveLength(0);

  page.load();

  expect(page.sockets).toHaveLength(1);
});

it("loads nothing into a page whose own Ayme runtime has started", () => {
  const page = runInitScript({ slot: { contract: {} } });

  expect(page.sockets).toHaveLength(0);
});

it("loads the served runtime into a page whose Inspector waits for a runtime that never started", () => {
  const page = runInitScript({ slot: {} });

  expect(page.sockets).toHaveLength(1);
});
