import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { resolveConfig, type InlineConfig } from "vite";
import { describe, expect, it } from "vitest";

import { type AymeOptions } from "./index";
import { ayme } from "./vite";

type VitePlugin = Extract<ReturnType<typeof ayme>, { config?: unknown }>;
type ConfigHook = Extract<
  NonNullable<VitePlugin["config"]>,
  (...args: never[]) => unknown
>;
type UserConfig = Parameters<ConfigHook>[0];

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_ID_ATTRIBUTE_DEFINE = "__AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__";

async function applyPluginConfig(
  config: UserConfig,
  options: AymeOptions = {}
) {
  const plugin = ayme(options);
  if (Array.isArray(plugin)) {
    throw new Error("Expected a single Vite plugin");
  }
  if (typeof plugin.config !== "function") {
    throw new Error("Expected the Vite plugin to define a config hook");
  }

  const configHook = plugin.config;
  return await Reflect.apply(configHook, null, [
    config,
    { command: "serve", mode: "test" },
  ]);
}

describe("ayme Vite integration", () => {
  it("accepts projects with omitted and explicit default test IDs", async () => {
    await expect(
      applyPluginConfig(
        { root: resolve(__dirname, "fixtures/playwright-default-projects") },
        { playwright: { config: "playwright.config.ts" } }
      )
    ).resolves.toEqual({
      define: {
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-testid"',
      },
      optimizeDeps: { exclude: ["@playwright/test"] },
    });
  });
  it("adds the Playwright test runner exclusion when no optimizer config exists", async () => {
    await expect(applyPluginConfig({})).resolves.toEqual({
      define: {
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-testid"',
      },
      optimizeDeps: { exclude: ["@playwright/test"] },
    });
  });

  it("excludes the Playwright test runner from dependency optimization", async () => {
    await expect(
      applyPluginConfig({
        optimizeDeps: { exclude: ["existing-dependency"] },
      })
    ).resolves.toEqual({
      define: {
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-testid"',
      },
      optimizeDeps: {
        exclude: ["existing-dependency", "@playwright/test"],
      },
    });
  });

  it("does not duplicate an existing Playwright test exclusion", async () => {
    await expect(
      applyPluginConfig({
        optimizeDeps: { exclude: ["@playwright/test"] },
      })
    ).resolves.toEqual({
      define: {
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-testid"',
      },
      optimizeDeps: { exclude: ["@playwright/test"] },
    });
  });

  it("loads top-level settings from a real config with explicit empty projects", async () => {
    await expect(
      applyPluginConfig(
        {
          root: resolve(__dirname, "fixtures/playwright-test-id"),
        },
        {
          playwright: {
            config: resolve(
              __dirname,
              "fixtures/playwright-test-id/playwright.config.ts"
            ),
          },
        }
      )
    ).resolves.toEqual({
      define: {
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-pw,data-ti"',
        __AYME_PLAYWRIGHT_ACTION_TIMEOUT__: "11",
        __AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__: "22",
      },
      optimizeDeps: { exclude: ["@playwright/test"] },
    });
  });

  it.each<[string, InlineConfig, unknown]>([
    ["sets it when the consumer has not", {}, true],
    [
      "keeps the consumer's own setting",
      { oxc: { decorator: { legacy: false } } },
      false,
    ],
    [
      "keeps the consumer's other oxc options",
      { oxc: { jsx: { pragma: "h" } } },
      true,
    ],
    ["does nothing with oxc off", { oxc: false }, undefined],
    [
      "does nothing when the consumer uses esbuild options",
      { esbuild: { jsx: "automatic" } },
      undefined,
    ],
  ])("on Vite 8, legacy decorators: %s", async (_, config, legacy) => {
    const resolved = await resolveConfig(
      { ...config, configFile: false, logLevel: "silent", plugins: [ayme()] },
      "serve"
    );
    expect(
      resolved.oxc === false ? undefined : resolved.oxc.decorator?.legacy
    ).toBe(legacy);
    if (config.oxc) expect(resolved.oxc).toMatchObject(config.oxc);
  });
});
