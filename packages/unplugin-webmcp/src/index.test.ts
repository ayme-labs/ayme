import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { unpluginFactory, type AymeWebMcpOptions } from "./index";

const TEST_ID_ATTRIBUTE_DEFINE = "__AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__";
const ACTION_TIMEOUT_DEFINE = "__AYME_PLAYWRIGHT_ACTION_TIMEOUT__";
const NAVIGATION_TIMEOUT_DEFINE = "__AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__";

async function applyPluginConfig(
  root: string,
  options: AymeWebMcpOptions = {}
) {
  const pluginResult = unpluginFactory(options, {
    framework: "vite",
    versions: {},
  });
  const plugin = Array.isArray(pluginResult) ? pluginResult[0] : pluginResult;
  if (!plugin?.vite?.config) throw new Error("Expected Vite config hook.");
  const configHook = plugin.vite.config;
  return (await Reflect.apply(
    typeof configHook === "function" ? configHook : configHook.handler,
    undefined,
    [{ root }]
  )) as { define?: Record<string, unknown> };
}

function writeFakeLoader(
  root: string,
  source = `exports.transform = {
  requireOrImport: async () => ({ default: {} }),
};
exports.configLoader = {
  loadConfigFromFile: async () => ({ projects: [] }),
};`,
  version = "1.62.1"
) {
  const playwrightRoot = join(
    root,
    "node_modules/@playwright/test/node_modules/playwright"
  );
  mkdirSync(join(playwrightRoot, "lib/common"), { recursive: true });
  writeFileSync(
    join(root, "node_modules/@playwright/test/package.json"),
    JSON.stringify({ version })
  );
  writeFileSync(
    join(playwrightRoot, "package.json"),
    JSON.stringify({ version })
  );
  writeFileSync(join(playwrightRoot, "lib/common/index.js"), source);
}

function writePackage(root: string) {
  writeFileSync(join(root, "package.json"), "{}");
}

describe("ayme WebMCP transform", () => {
  it("types only the supported Playwright overrides", () => {
    const supported: AymeWebMcpOptions = {
      playwright: {
        use: {
          testIdAttribute: "data-testid",
          actionTimeout: 0,
          navigationTimeout: 25,
        },
      },
    };
    const unsupportedOption: AymeWebMcpOptions = {
      playwright: {
        use: {
          // @ts-expect-error Playwright fields outside Ayme's supported subset are rejected.
          baseURL: "https://example.test",
        },
      },
    };
    const wrongTimeout: AymeWebMcpOptions = {
      playwright: {
        use: {
          // @ts-expect-error Supported timeout values are numbers.
          actionTimeout: "slow",
        },
      },
    };
    expect(supported.playwright?.use?.actionTimeout).toBe(0);
    void unsupportedOption;
    void wrongTimeout;
  });

  it("does not discover or import a config for override-only startup", async () => {
    const root = mkdtempSync(join(tmpdir(), "ayme-webmcp-overrides-"));
    try {
      writePackage(root);
      writeFileSync(join(root, "playwright.config.ts"), "invalid config");
      await expect(
        applyPluginConfig(root, {
          playwright: {
            use: { testIdAttribute: "data-qa", actionTimeout: 0 },
          },
        })
      ).resolves.toMatchObject({
        define: {
          [TEST_ID_ATTRIBUTE_DEFINE]: JSON.stringify("data-qa"),
          [ACTION_TIMEOUT_DEFINE]: JSON.stringify(0),
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses defaults without a Playwright config", async () => {
    const root = mkdtempSync(join(tmpdir(), "ayme-webmcp-no-config-"));
    try {
      writePackage(root);
      await expect(applyPluginConfig(root)).resolves.toMatchObject({
        define: { [TEST_ID_ATTRIBUTE_DEFINE]: JSON.stringify("data-testid") },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads an explicit config relative to Vite root and emits only supported settings", async () => {
    const root = mkdtempSync(join(tmpdir(), "ayme-webmcp-config-"));
    try {
      writePackage(root);
      const configPath = join(root, "configs/playwright.config.mjs");
      mkdirSync(join(root, "configs"), { recursive: true });
      writeFileSync(configPath, "export default {};");
      writeFakeLoader(
        root,
        `exports.transform = {
  requireOrImport: async () => ({ default: {} }),
};
exports.configLoader = {
  loadConfigFromFile: async () => ({
    projects: [{
      project: {
        name: "chromium",
        use: {
          testIdAttribute: "data-pw",
          actionTimeout: 10,
          navigationTimeout: 20,
          baseURL: "https://not-in-the-browser-bundle.example",
        },
      },
    }],
  }),
};`
      );
      const config = await applyPluginConfig(root, {
        playwright: { config: "configs/playwright.config.mjs" },
      });
      expect(config).toMatchObject({
        define: {
          [TEST_ID_ATTRIBUTE_DEFINE]: JSON.stringify("data-pw"),
          [ACTION_TIMEOUT_DEFINE]: JSON.stringify(10),
          [NAVIGATION_TIMEOUT_DEFINE]: JSON.stringify(20),
        },
      });
      expect(config.define).not.toHaveProperty("baseURL");
      await expect(
        applyPluginConfig(root, {
          playwright: {
            config: "configs/playwright.config.mjs",
            use: { actionTimeout: 0, navigationTimeout: undefined },
          },
        })
      ).resolves.toMatchObject({
        define: {
          [TEST_ID_ATTRIBUTE_DEFINE]: JSON.stringify("data-pw"),
          [ACTION_TIMEOUT_DEFINE]: JSON.stringify(0),
          [NAVIGATION_TIMEOUT_DEFINE]: JSON.stringify(20),
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports explicit config, loader, project, and ambiguity errors", async () => {
    const missingRoot = mkdtempSync(join(tmpdir(), "ayme-webmcp-missing-"));
    try {
      writePackage(missingRoot);
      await expect(
        applyPluginConfig(missingRoot, {
          playwright: { config: "missing.config.ts" },
        })
      ).rejects.toThrow(/file does not exist/);
    } finally {
      rmSync(missingRoot, { recursive: true, force: true });
    }

    const unsupportedRoot = mkdtempSync(
      join(tmpdir(), "ayme-webmcp-unsupported-loader-")
    );
    try {
      writePackage(unsupportedRoot);
      writeFileSync(
        join(unsupportedRoot, "playwright.config.ts"),
        "export default {};"
      );
      writeFakeLoader(unsupportedRoot, "exports.configLoader = {};", "1.63.0");
      await expect(
        applyPluginConfig(unsupportedRoot, {
          playwright: { config: "playwright.config.ts" },
        })
      ).rejects.toThrow(/supports Playwright 1\.62\.x only/);
    } finally {
      rmSync(unsupportedRoot, { recursive: true, force: true });
    }

    const root = mkdtempSync(join(tmpdir(), "ayme-webmcp-ambiguous-"));
    try {
      writePackage(root);
      writeFileSync(join(root, "playwright.config.ts"), "export default {};");
      writeFakeLoader(
        root,
        `exports.transform = {
  requireOrImport: async () => ({ default: {} }),
};
exports.configLoader = {
  loadConfigFromFile: async () => ({
    projects: [
      { project: { name: "chromium", use: { actionTimeout: 10 } } },
      { project: { name: "firefox", use: { actionTimeout: 20 } } },
    ],
  }),
};`
      );
      await expect(
        applyPluginConfig(root, {
          playwright: { config: "playwright.config.ts" },
        })
      ).rejects.toThrow(/different supported settings/);
      await expect(
        applyPluginConfig(root, {
          playwright: {
            config: "playwright.config.ts",
            project: "chromium",
            use: { actionTimeout: 0 },
          },
        })
      ).resolves.toMatchObject({
        define: { [ACTION_TIMEOUT_DEFINE]: JSON.stringify(0) },
      });
      await expect(
        applyPluginConfig(root, {
          playwright: { config: "playwright.config.ts", project: "safari" },
        })
      ).rejects.toThrow(/found 0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    const malformedRoot = mkdtempSync(join(tmpdir(), "ayme-webmcp-shape-"));
    try {
      writePackage(malformedRoot);
      writeFileSync(
        join(malformedRoot, "playwright.config.ts"),
        "export default {};"
      );
      writeFakeLoader(
        malformedRoot,
        `exports.transform = {
  requireOrImport: async () => ({ default: {} }),
};
exports.configLoader = {
  loadConfigFromFile: async () => ({ projects: [{ use: {} }] }),
};`
      );
      await expect(
        applyPluginConfig(malformedRoot, {
          playwright: { config: "playwright.config.ts" },
        })
      ).rejects.toThrow(/projects\[0\]\.project must be an object/);
    } finally {
      rmSync(malformedRoot, { recursive: true, force: true });
    }
  });

  it("registers metadata without generating a constructor factory", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/annotatedChildrenPom.ts", import.meta.url)
    );
    const source = readFileSync(fixturePath, "utf8");
    const pluginResult = unpluginFactory(
      {},
      { framework: "vite", versions: {} }
    );
    const plugin = Array.isArray(pluginResult) ? pluginResult[0] : pluginResult;
    if (!plugin) throw new Error("Expected a plugin.");
    const transform = plugin.transform;

    if (!transform || typeof transform === "function")
      throw new Error("Expected an object transform hook.");

    const result: unknown = await Reflect.apply(transform.handler, undefined, [
      source,
      fixturePath,
    ]);
    if (
      !result ||
      typeof result === "string" ||
      typeof result !== "object" ||
      !("code" in result) ||
      typeof result.code !== "string"
    )
      throw new Error("Expected transformed code.");

    const registrations = result.code
      .split("\n")
      .filter((line) => line.startsWith("registerCompiledPom("));

    expect(registrations).toHaveLength(2);
    expect(registrations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("registerCompiledPom(AnnotatedComponent, "),
        expect.stringContaining("registerCompiledPom(AnnotatedChildrenPom, "),
      ])
    );
    expect(registrations.every((line) => !line.includes("=> new "))).toBe(true);
  });
});
