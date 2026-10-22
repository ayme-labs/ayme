import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { resolveConfig, type InlineConfig } from "vite";
import { describe, expect, it, vi } from "vitest";

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
        { include: true, playwright: { config: "playwright.config.ts" } }
      )
    ).resolves.toEqual({
      define: {
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-testid"',
      },
      optimizeDeps: { exclude: ["@playwright/test"] },
    });
  });
  it("adds the Playwright test runner exclusion when no optimizer config exists", async () => {
    await expect(applyPluginConfig({}, { include: true })).resolves.toEqual({
      define: {
        [TEST_ID_ATTRIBUTE_DEFINE]: '"data-testid"',
      },
      optimizeDeps: { exclude: ["@playwright/test"] },
    });
  });

  it("excludes the Playwright test runner from dependency optimization", async () => {
    await expect(
      applyPluginConfig(
        { optimizeDeps: { exclude: ["existing-dependency"] } },
        { include: true }
      )
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
      applyPluginConfig(
        { optimizeDeps: { exclude: ["@playwright/test"] } },
        { include: true }
      )
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
          include: true,
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

  describe("resolving in a build without Ayme, the default", () => {
    const resolveThrough = async (
      specifier: string,
      context: {
        ssr?: boolean;
        consumer?: string;
        options?: AymeOptions;
      } = {}
    ) => {
      const { consumer = "client" } = context;
      const plugin = ayme(context.options);
      if (Array.isArray(plugin)) throw new Error("Expected a single plugin");
      const hook = plugin.resolveId;
      if (typeof hook !== "function")
        throw new Error("Expected the Vite plugin to define a resolveId hook");
      const resolve = vi.fn(async (id: string) => ({ id: `/resolved/${id}` }));
      const resolved = await Reflect.apply(
        hook,
        {
          resolve,
          environment: { config: { consumer } },
        },
        [specifier, "/app/main.ts", { ssr: context.ssr }]
      );
      return { resolved, resolve };
    };

    it("resolves the runtime's entries and the framework packages to their absent ones, through the next resolver", async () => {
      for (const [specifier, absent] of [
        ["@ayme-dev/ayme", "@ayme-dev/ayme/absent"],
        ["@ayme-dev/ayme/internal", "@ayme-dev/ayme/absent"],
        ...["vue", "react", "svelte", "angular"].map((framework) => [
          `@ayme-dev/${framework}`,
          `@ayme-dev/${framework}/absent`,
        ]),
      ]) {
        const { resolved, resolve } = await resolveThrough(specifier!, {
          consumer: "client",
        });
        expect(resolved).toEqual({ id: `/resolved/${absent}` });
        expect(resolve).toHaveBeenCalledWith(absent, "/app/main.ts", {
          skipSelf: true,
        });
      }
    });

    it("leaves every other specifier to Vite", async () => {
      for (const untouched of [
        "@ayme-dev/ayme/server",
        "@ayme-dev/ayme/absent",
        "@ayme-dev/vue/absent",
        "@ayme-dev/angular/package.json",
        "@ayme-dev/webmcp",
        "./ListPage",
      ]) {
        const { resolved, resolve } = await resolveThrough(untouched, {
          consumer: "client",
        });
        expect(resolved).toBeNull();
        expect(resolve).not.toHaveBeenCalled();
      }
    });

    it("leaves a server module to Vite, whether its environment or the ssr flag says so", async () => {
      for (const context of [{ consumer: "server" }, { ssr: true }]) {
        const { resolved, resolve } = await resolveThrough(
          "@ayme-dev/ayme",
          context
        );
        expect(resolved).toBeNull();
        expect(resolve).not.toHaveBeenCalled();
      }
    });

    it("resolves nothing once include is true", async () => {
      const { resolved, resolve } = await resolveThrough("@ayme-dev/ayme", {
        consumer: "client",
        options: { include: true },
      });
      expect(resolved).toBeNull();
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  it("rejects an include that is not a boolean", () => {
    expect(() => ayme({ include: "yes" as unknown as boolean })).toThrow(
      new TypeError("include must be a boolean")
    );
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
