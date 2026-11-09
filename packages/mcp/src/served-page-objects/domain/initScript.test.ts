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
 * runtime, the modules it imports and the stamp socket the test drives.
 */
function runInitScript(options?: Parameters<typeof initScript>[1]) {
  const imports: Pending[] = [];
  const registered: string[] = [];
  const startedWith: unknown[] = [];
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
  const createAyme = (runtimeOptions: { pageObjects: { name: string }[] }) => {
    startedWith.push(runtimeOptions);
    registered.push(...runtimeOptions.pageObjects.map((model) => model.name));
    return { start() {}, pom };
  };
  const window = {};
  (window as { top: unknown }).top = window;
  const script = initScript(4720, options).replaceAll(
    "import(",
    "importModule("
  );
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
    registered,
    startedWith,
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
  };
}

const entry = (...names: (string | { name: string; fails: true })[]) => ({
  default: names.map((name) => (typeof name === "string" ? { name } : name)),
});

async function started(options?: Parameters<typeof initScript>[1]) {
  const page = runInitScript(options);
  page.stamp("e1");
  await page.answer(/runtime\.js\?build=r1$/, { createAyme: page.createAyme });
  await page.answer(/entry\.js\?build=e1$/, entry("A"));
  return page;
}

it("loads the build of the first stamp it is told of", async () => {
  const page = await started();

  expect(page.registered).toEqual(["A"]);
});

it("starts the runtime with the Agent Connection and the external Inspector, WebMCP publication left off", async () => {
  const page = await started();

  expect(page.startedWith).toEqual([
    {
      agentConnection: true,
      inspector: { placement: "external" },
      pageObjects: [{ name: "A" }],
    },
  ]);
  expect(initScript(4720)).not.toMatch(/webmcp/i);
});

it("with webMCP, starts the same runtime with WebMCP publication on too", async () => {
  const page = await started({ webMCP: true });

  expect(page.startedWith).toEqual([
    {
      agentConnection: true,
      inspector: { placement: "external" },
      pageObjects: [{ name: "A" }],
      webMCP: { enabled: true },
    },
  ]);
  expect(page.registered).toEqual(["A"]);
});

it("writes the same script without the option as with it off", () => {
  expect(initScript(4720, { webMCP: false })).toBe(initScript(4720));
  expect(initScript(4720, {})).toBe(initScript(4720));
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
