import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";
import { ayme } from "./vite";

const fileName = fileURLToPath(
  new URL("./__tests__/fixtures/turbopack/CounterPage.ts", import.meta.url)
);
const source = readFileSync(fileName, "utf8");

it("only compiles Page Objects for the browser graph", async () => {
  const result = ayme({ include: true });
  const plugin = Array.isArray(result) ? result[0] : result;
  const hook = plugin?.transform;
  if (!hook) throw new Error("Expected the Vite transform hook.");
  const transform = typeof hook === "function" ? hook : hook.handler;
  // The client environment and the watch-file method Vite 7 and 8 give a hook.
  const context = {
    meta: { viteVersion: "8.2.2" },
    environment: { config: { consumer: "client" } },
    addWatchFile() {},
  };

  expect(
    await Reflect.apply(transform, context, [source, fileName, { ssr: true }])
  ).toBeNull();
  for (const options of [{ ssr: false }, undefined]) {
    const transformed = (await Reflect.apply(transform, context, [
      source,
      fileName,
      options,
    ])) as { code: string };
    expect(transformed.code).toContain("registerCompiledPom(CounterPage,");
    expect(transformed.code).toContain("CounterPage.increment");
  }
});

it("retains shared Playwright defines in both build targets", async () => {
  for (const isSsrBuild of [false, true]) {
    const result = ayme({
      playwright: { use: { testIdAttribute: "data-qa", actionTimeout: 100 } },
    });
    const plugin = Array.isArray(result) ? result[0] : result;
    const hook = plugin?.config;
    if (!hook) throw new Error("Expected the Vite config hook.");
    const config = await Reflect.apply(
      typeof hook === "function" ? hook : hook.handler,
      undefined,
      [{}, { command: "build", mode: "production", isSsrBuild }]
    );
    expect(config).toMatchObject({
      define: {
        __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__: '"data-qa"',
        __AYME_PLAYWRIGHT_ACTION_TIMEOUT__: "100",
      },
    });
  }
});

// Integration: a server build keeps Vite's own emit. Without `include`, the
// client output resolves the runtime to its absent entry, but the server
// bundle carries the real runtime and each Page Object Model's body.
it("a server build with include unset keeps the real runtime", async () => {
  const root = fileURLToPath(
    new URL("./__tests__/fixtures/withoutAyme/", import.meta.url)
  );
  const result = await build({
    configFile: false,
    logLevel: "silent",
    root,
    plugins: [ayme({ report: "none" })],
    build: {
      write: false,
      ssr: join(root, "main.ts"),
      rolldownOptions: {
        // The runtime's own dependencies: the fixture resolves the linked
        // runtime, and nothing of it is under test.
        external: [/^@playwright\//, /^@ayme-dev\/(core|webmcp)/],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!output || !("output" in output))
    throw new Error("Expected the build's output in memory.");
  const code = output.output
    .map((chunk) => ("code" in chunk ? chunk.code : ""))
    .join("\n");

  expect(code).toContain("Waiting for the WebMCP driver.");
  expect(code).toContain("Add an item to the list.");
  expect(code).not.toContain("Ayme was removed from this build.");
  expect(code).not.toContain("absentPageObject");
}, 30_000);
