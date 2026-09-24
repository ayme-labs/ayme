import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createUnplugin, type UnpluginFactory } from "unplugin";

import type { PomCompilerOptions } from "./derivePomManifests";
import { createPomTransform } from "./transformPomModule";

const PLAYWRIGHT_TEST_PACKAGE = "@playwright/test";
const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";
const TEST_ID_ATTRIBUTE_DEFINE = "__AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__";
const ACTION_TIMEOUT_DEFINE = "__AYME_PLAYWRIGHT_ACTION_TIMEOUT__";
const NAVIGATION_TIMEOUT_DEFINE = "__AYME_PLAYWRIGHT_NAVIGATION_TIMEOUT__";
const PUBLISH_DEFINE = "__AYME_WEBMCP_PUBLISH__";
const INSPECTOR_MODULE_ID = "virtual:ayme-webmcp-inspector";
const RESOLVED_INSPECTOR_MODULE_ID = `\0${INSPECTOR_MODULE_ID}`;
const INSPECTOR_PACKAGE_ID = "@ayme-dev/webmcp-inspector";
const SUPPORTED_PLAYWRIGHT_VERSION = /^1\.62\.\d+(?:[-+].*)?$/;

// Keep published declarations usable without the optional Playwright peer.
// The type contract test checks this subset against Playwright's exported type.
type SupportedPlaywrightUse = {
  testIdAttribute?: string;
  actionTimeout?: number;
  navigationTimeout?: number;
};

export type AymePlaywrightOptions = {
  config?: string;
  project?: string;
  use?: SupportedPlaywrightUse;
};

type SupportedPlaywrightSettings = SupportedPlaywrightUse;

type PlaywrightConfigLoader = {
  loadConfigFromFile(configFile: string): Promise<unknown>;
};

type PlaywrightTransform = {
  requireOrImport(file: string): Promise<unknown>;
};

type PlaywrightLoaderModule = {
  configLoader?: PlaywrightConfigLoader;
  transform?: PlaywrightTransform;
};

type LoadedPlaywrightConfig = {
  fullConfig: unknown;
  rawConfig: unknown;
};

export type AymeWebMcpOptions = PomCompilerOptions & {
  inspector?: boolean;
  playwright?: AymePlaywrightOptions;
  publish?: boolean;
};

export const unpluginFactory: UnpluginFactory<AymeWebMcpOptions | undefined> = (
  options = {}
) => {
  if (options.publish !== undefined && typeof options.publish !== "boolean")
    throw new TypeError("publish must be a boolean");
  if (options.inspector !== undefined && typeof options.inspector !== "boolean")
    throw new TypeError("inspector must be a boolean");
  const transformPom = createPomTransform(options);
  // Vite soft-invalidates static importers of a changed file and keeps their
  // previous transform result, so a Page Object compiled from a changed base
  // class would keep a stale manifest. Record which transformed modules read
  // each compiler dependency and hard-invalidate them when it changes.
  const viteDependants = new Map<string, Set<string>>();

  return {
    name: "ayme-webmcp",
    enforce: "pre",
    ...(options.inspector
      ? {
          resolveId(id) {
            if (id === INSPECTOR_PACKAGE_ID)
              return createRequire(import.meta.url).resolve(
                INSPECTOR_PACKAGE_ID
              );
            return id === INSPECTOR_MODULE_ID
              ? RESOLVED_INSPECTOR_MODULE_ID
              : null;
          },
          load(id) {
            return id === RESOLVED_INSPECTOR_MODULE_ID
              ? "import { mountInspector } from '@ayme-dev/webmcp-inspector'; mountInspector();"
              : null;
          },
        }
      : {}),
    vite: {
      ...(options.inspector
        ? {
            transformIndexHtml: {
              order: "pre" as const,
              handler() {
                return [
                  {
                    tag: "script",
                    attrs: { type: "module" },
                    children: `import '${INSPECTOR_MODULE_ID}';`,
                    injectTo: "head-prepend" as const,
                  },
                ];
              },
            },
          }
        : {}),
      transform: {
        filter: { id: /\.[cm]?[jt]sx?$/ },
        handler(code, id, transformOptions) {
          if (transformOptions?.ssr) return null;
          const transformed = transformPom(code, id);
          for (const dependency of transformed?.dependencies ?? []) {
            const dependants = viteDependants.get(dependency) ?? new Set();
            viteDependants.set(dependency, dependants.add(id));
          }
          return transformed;
        },
      },
      watchChange(file) {
        if (this.environment.mode !== "dev") return;
        const moduleGraph = this.environment.moduleGraph;
        for (const id of viteDependants.get(resolve(file)) ?? []) {
          const module = moduleGraph.getModuleById(id);
          if (module) moduleGraph.invalidateModule(module);
        }
      },
      async config(config) {
        const exclude = config.optimizeDeps?.exclude ?? [];
        const settings = await resolvePlaywrightSettings(
          options.playwright,
          config.root ?? process.cwd()
        );
        const define: Record<string, unknown> = {
          ...config.define,
          [PUBLISH_DEFINE]: JSON.stringify(options.publish ?? false),
          [TEST_ID_ATTRIBUTE_DEFINE]: JSON.stringify(
            settings.testIdAttribute ?? DEFAULT_TEST_ID_ATTRIBUTE
          ),
        };
        if (settings.actionTimeout !== undefined)
          define[ACTION_TIMEOUT_DEFINE] = JSON.stringify(
            settings.actionTimeout
          );
        if (settings.navigationTimeout !== undefined)
          define[NAVIGATION_TIMEOUT_DEFINE] = JSON.stringify(
            settings.navigationTimeout
          );

        return {
          define,
          optimizeDeps: {
            ...config.optimizeDeps,
            exclude: [...new Set([...exclude, PLAYWRIGHT_TEST_PACKAGE])],
          },
        };
      },
    },
    transform: {
      filter: {
        id: /\.ts$/,
      },
      handler: transformPom,
    },
  };
};

async function resolvePlaywrightSettings(
  options: AymePlaywrightOptions | undefined,
  root: string
): Promise<SupportedPlaywrightSettings> {
  if (options !== undefined) {
    if (!isRecord(options))
      throw new TypeError("playwright options must be an object");
    const unsupported = Object.keys(options).filter(
      (key) => !["config", "project", "use"].includes(key)
    );
    if (unsupported.length > 0)
      throw new TypeError(
        `playwright contains unsupported option(s): ${unsupported.join(", ")}`
      );
  }
  const overrides = supportedSettingsFromUse(
    options?.use,
    "playwright.use",
    true
  );
  const configPath = options?.config;
  if (configPath === undefined) {
    if (options?.project !== undefined)
      throw new TypeError(
        "playwright.project requires an explicit playwright.config path"
      );
    return overrides;
  }

  if (typeof configPath !== "string" || configPath.trim() === "")
    throw new TypeError("playwright.config must be a non-empty string");
  if (
    options?.project !== undefined &&
    (typeof options.project !== "string" || options.project.length === 0)
  )
    throw new TypeError("playwright.project must be a non-empty string");

  const absoluteConfigPath = resolve(root, configPath);
  const loadedConfig = await loadPlaywrightConfig(absoluteConfigPath, root);
  const configSettings = selectPlaywrightSettings(
    loadedConfig,
    options?.project,
    absoluteConfigPath
  );
  return {
    ...configSettings,
    ...overrides,
  };
}

async function loadPlaywrightConfig(
  configPath: string,
  root: string
): Promise<LoadedPlaywrightConfig> {
  if (!existsSync(configPath))
    throw new Error(
      `Could not load Playwright config "${configPath}": file does not exist.`
    );

  const consumerRequire = createRequire(resolve(root, "package.json"));
  let playwrightTestPackagePath: string;
  try {
    playwrightTestPackagePath = consumerRequire.resolve(
      `${PLAYWRIGHT_TEST_PACKAGE}/package.json`
    );
  } catch (error) {
    throw new Error(
      `Could not load Playwright config "${configPath}": ${errorMessage(error)}`,
      { cause: error }
    );
  }

  let playwrightPackagePath: string;
  try {
    playwrightPackagePath = createRequire(playwrightTestPackagePath).resolve(
      "playwright/package.json"
    );
  } catch (error) {
    throw new Error(
      `Could not load Playwright config "${configPath}": could not resolve the consumer's playwright package (${errorMessage(error)}).`,
      { cause: error }
    );
  }

  const playwrightVersion = readPackageVersion(playwrightPackagePath);
  if (!SUPPORTED_PLAYWRIGHT_VERSION.test(playwrightVersion))
    throw new Error(
      `Unsupported Playwright config loader version ${playwrightVersion}. Ayme supports Playwright 1.62.x only.`
    );

  // Playwright does not expose its config loader publicly. Keep this one
  // private import in the explicit-config path and guard the pinned boundary.
  const loaderPath = resolve(
    dirname(playwrightPackagePath),
    "lib/common/index.js"
  );
  if (!existsSync(loaderPath))
    throw new Error(
      `Unsupported Playwright config loader: ${loaderPath} does not exist. Ayme supports Playwright 1.62.x only.`
    );

  let loaderModule: PlaywrightLoaderModule;
  try {
    loaderModule = (await import(
      pathToFileURL(loaderPath).href
    )) as typeof loaderModule;
  } catch (error) {
    throw new Error(
      `Unsupported Playwright config loader at ${loaderPath}: ${errorMessage(error)}`,
      { cause: error }
    );
  }
  if (
    !loaderModule.configLoader ||
    typeof loaderModule.configLoader.loadConfigFromFile !== "function" ||
    !loaderModule.transform ||
    typeof loaderModule.transform.requireOrImport !== "function"
  )
    throw new Error(
      `Unsupported Playwright config loader at ${loaderPath}: expected configLoader.loadConfigFromFile and transform.requireOrImport for Playwright 1.62.x.`
    );

  let fullConfig: unknown;
  try {
    fullConfig = await loaderModule.configLoader.loadConfigFromFile(configPath);
  } catch (error) {
    throw new Error(
      `Could not load Playwright config "${configPath}": ${errorMessage(error)}`,
      { cause: error }
    );
  }

  let rawConfig: unknown;
  try {
    rawConfig = normalizeDefaultExport(
      await loaderModule.transform.requireOrImport(configPath)
    );
  } catch (error) {
    throw new Error(
      `Could not load Playwright config "${configPath}": ${errorMessage(error)}`,
      { cause: error }
    );
  }

  return { fullConfig, rawConfig };
}

function readPackageVersion(packagePath: string): string {
  try {
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      version?: unknown;
    };
    if (typeof packageJson.version !== "string")
      throw new Error("package.json has no string version");
    return packageJson.version;
  } catch (error) {
    throw new Error(
      `Unsupported Playwright config loader: could not read ${packagePath} (${errorMessage(error)}).`,
      { cause: error }
    );
  }
}

function selectPlaywrightSettings(
  loadedConfig: unknown,
  projectName: string | undefined,
  configPath: string
): SupportedPlaywrightSettings {
  if (!isRecord(loadedConfig))
    throw invalidLoadedConfig(configPath, "the loader returned a non-object");

  const rawConfig = loadedConfig.rawConfig;
  if (!isRecord(rawConfig))
    throw invalidLoadedConfig(configPath, "the raw config is not an object");

  const topLevel = supportedSettingsFromUse(
    rawConfig.use,
    "top-level playwright.use"
  );
  const fullConfig = loadedConfig.fullConfig;
  if (!isRecord(fullConfig))
    throw invalidLoadedConfig(configPath, "the loader returned no full config");
  const projectEntries = fullConfig.projects;
  if (!Array.isArray(projectEntries))
    throw invalidLoadedConfig(configPath, "projects must be an array");

  const projects = projectEntries.map((entry: unknown, index: number) => {
    if (!isRecord(entry) || !isRecord(entry.project))
      throw invalidLoadedConfig(
        configPath,
        `projects[${index}].project must be an object`
      );
    const project = entry.project;
    const name = project.name;
    if (name !== undefined && typeof name !== "string")
      throw invalidLoadedConfig(
        configPath,
        `projects[${index}].project.name must be a string`
      );
    return {
      name: typeof name === "string" ? name : "",
      settings: {
        testIdAttribute: DEFAULT_TEST_ID_ATTRIBUTE,
        ...topLevel,
        ...supportedSettingsFromUse(
          project.use,
          `projects[${index}].project.use`
        ),
      },
    };
  });

  if (projectName !== undefined) {
    const matches = projects.filter((project) => project.name === projectName);
    if (matches.length !== 1)
      throw new Error(
        `Playwright project "${projectName}" must exist exactly once in ${configPath}; found ${matches.length}.`
      );
    return matches[0]!.settings;
  }

  if (projects.length === 0) return topLevel;
  if (projects.length === 1) return projects[0]!.settings;

  const common = projects[0]!.settings;
  const differingFields = SUPPORTED_SETTING_KEYS.filter((key) =>
    projects.some((project) => project.settings[key] !== common[key])
  );
  if (differingFields.length > 0)
    throw new Error(
      `Playwright projects have different supported settings (${differingFields.join(", ")}); set playwright.project explicitly.`
    );
  return common;
}

const SUPPORTED_SETTING_KEYS = [
  "testIdAttribute",
  "actionTimeout",
  "navigationTimeout",
] as const;

function supportedSettingsFromUse(
  value: unknown,
  label: string,
  rejectUnsupported = false
): SupportedPlaywrightSettings {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);

  const unsupported = Object.keys(value).filter(
    (key) =>
      !SUPPORTED_SETTING_KEYS.includes(
        key as (typeof SUPPORTED_SETTING_KEYS)[number]
      )
  );
  if (rejectUnsupported && unsupported.length > 0)
    throw new TypeError(
      `${label} contains unsupported option(s): ${unsupported.join(", ")}`
    );

  const settings: SupportedPlaywrightSettings = {};
  const testIdAttribute = value.testIdAttribute;
  if (testIdAttribute !== undefined) {
    if (typeof testIdAttribute !== "string" || testIdAttribute.length === 0)
      throw new TypeError(
        `${label}.testIdAttribute must be a non-empty string`
      );
    settings.testIdAttribute = testIdAttribute;
  }
  for (const key of ["actionTimeout", "navigationTimeout"] as const) {
    const timeout = value[key];
    if (timeout === undefined) continue;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0)
      throw new TypeError(
        `${label}.${key} must be a non-negative finite number`
      );
    settings[key] = timeout;
  }
  return settings;
}

function invalidLoadedConfig(configPath: string, detail: string): Error {
  return new Error(
    `Invalid Playwright configuration "${configPath}": ${detail}.`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDefaultExport(value: unknown): unknown {
  if (isRecord(value) && "default" in value) return value.default;
  return value;
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);

export { createPomCompiler, derivePomManifests } from "./derivePomManifests";
export type { PomCompiler, PomCompilerOptions } from "./derivePomManifests";
