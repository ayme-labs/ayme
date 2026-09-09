import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { type AymeWebMcpOptions } from "./index";
import { aymeWebMcp } from "./vite";

type VitePlugin = Extract<ReturnType<typeof aymeWebMcp>, { config?: unknown }>;
type ConfigHook = Extract<
  NonNullable<VitePlugin["config"]>,
  (...args: never[]) => unknown
>;
type UserConfig = Parameters<ConfigHook>[0];

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_ID_ATTRIBUTE_DEFINE = "__AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__";
const PUBLISH_DEFINE = "__AYME_WEBMCP_PUBLISH__";

async function applyPluginConfig(
  config: UserConfig,
  options: AymeWebMcpOptions = {}
) {
  const plugin = aymeWebMcp(options);
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

describe("aymeWebMcp Vite integration", () => {
  it("injects Inspector startup only when explicitly enabled", async () => {
    const disabled = aymeWebMcp({ inspector: false });
    const enabled = aymeWebMcp({ inspector: true });
    if (Array.isArray(disabled) || Array.isArray(enabled))
      throw new Error("Expected single Vite plugins");

    const config = enabled.config;
    if (typeof config !== "function")
      throw new Error("Expected an Inspector entry resolver");
    await Reflect.apply(config, null, [
      { root: resolve(__dirname, "fixtures/inspector") },
      { command: "serve", mode: "test" },
    ]);
    const enabledTransform = enabled.transform;
    if (!enabledTransform || typeof enabledTransform === "function")
      throw new Error("Expected a filtered transform");
    const transformed = await Reflect.apply(enabledTransform.handler, null, [
      "console.log('app');",
      resolve(__dirname, "fixtures/inspector/src/main.ts"),
    ]);
    expect(transformed).toMatchObject({
      code: "import 'virtual:ayme-webmcp-inspector';\nconsole.log('app');",
    });

    const disabledTransformHook = disabled.transform;
    if (!disabledTransformHook || typeof disabledTransformHook === "function")
      throw new Error("Expected a filtered transform");
    const disabledTransform = await Reflect.apply(
      disabledTransformHook.handler,
      null,
      ["console.log('app');", "/src/main.ts"]
    );
    expect(disabledTransform).toBeNull();
  });

  it("disables publication by default and enables it explicitly", async () => {
    const defaultConfig = await applyPluginConfig({});
    const publishingConfig = await applyPluginConfig({}, { publish: true });

    expect(defaultConfig?.define?.[PUBLISH_DEFINE]).toBe("false");
    expect(publishingConfig?.define?.[PUBLISH_DEFINE]).toBe("true");
  });

  it("rejects a non-boolean publication policy", async () => {
    await expect(
      applyPluginConfig({}, { publish: "yes" } as never)
    ).rejects.toThrow("publish must be a boolean");
  });

  it("accepts projects with omitted and explicit default test IDs", async () => {
    await expect(
      applyPluginConfig(
        { root: resolve(__dirname, "fixtures/playwright-default-projects") },
        { playwright: { config: "playwright.config.ts" } }
      )
    ).resolves.toEqual({
      define: {
        [PUBLISH_DEFINE]: "false",
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-testid"',
      },
      optimizeDeps: { exclude: ["@playwright/test"] },
    });
  });
  it("adds the Playwright test runner exclusion when no optimizer config exists", async () => {
    await expect(applyPluginConfig({})).resolves.toEqual({
      define: {
        [PUBLISH_DEFINE]: "false",
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
        [PUBLISH_DEFINE]: "false",
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
        [PUBLISH_DEFINE]: "false",
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
        [PUBLISH_DEFINE]: "false",
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-pw,data-ti"',
        __AYME_PLAYWRIGHT_ACTION_TIMEOUT__: "11",
        __AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__: "22",
      },
      optimizeDeps: { exclude: ["@playwright/test"] },
    });
  });
});
