import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { aymeWebMcp } from "./vite";

const fileName = fileURLToPath(
  new URL("./__tests__/fixtures/turbopack/CounterPage.ts", import.meta.url)
);
const source = readFileSync(fileName, "utf8");

it("only compiles Page Objects for the browser graph", async () => {
  const result = aymeWebMcp();
  const plugin = Array.isArray(result) ? result[0] : result;
  const hook = plugin?.transform;
  if (!hook) throw new Error("Expected the Vite transform hook.");
  const transform = typeof hook === "function" ? hook : hook.handler;
  const context = { meta: { viteVersion: "8.2.2" } };

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

it("retains shared publication and Playwright defines in both build targets", async () => {
  for (const isSsrBuild of [false, true]) {
    const result = aymeWebMcp({
      publish: true,
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
        __AYME_WEBMCP_PUBLISH__: "true",
        __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__: '"data-qa"',
        __AYME_PLAYWRIGHT_ACTION_TIMEOUT__: "100",
      },
    });
  }
});
