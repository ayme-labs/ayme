/**
 * Packed-consumer regression for the publishable Ayme packages.
 *
 * Each package is built into an isolated staging directory, so the shared
 * workspace `dist` that parallel tests read is never mutated, and is packed
 * with the real `pnpm pack`, so consumers get pnpm's own `workspace:`
 * publication conversion. The tests then check that:
 *
 * 1. Packed manifests carry no `workspace:`, `link:` or `file:` specifiers,
 *    and internal `@ayme-dev/*` dependencies pin the sibling's version.
 * 2. Packed files contain no absolute local paths.
 * 3. A clean consumer installs all packages together and imports every
 *    declared export subpath.
 * 4. The packed @ayme-dev/ayme does not expose private workspace packages.
 * 5. Consumers type-check and load config with and without Playwright.
 * 6. A Vite config type-checks the library declarations with only Vite
 *    installed beside the packages.
 * 7. An Angular consumer type-checks at Angular's and TypeScript's floor.
 * 8. React, Vue and Svelte consumers type-check the published declarations
 *    at each adapter's framework floor.
 *
 * With `AYME_PACKED_DIR` set, the tarballs are packed into that empty
 * directory and kept, so the release workflow publishes exactly the
 * artefacts these tests checked.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const aymeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packagesRoot = path.dirname(aymeRoot);
const repoRoot = path.dirname(packagesRoot);

const PUBLISHED_PACKAGES = [
  "ayme",
  "inspector",
  "vue",
  "react",
  "angular",
  "svelte",
  "unplugin-ayme",
];

const PRIVATE_PACKAGES = ["@ayme-dev/playwright-lite", "@ayme-dev/core"];

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  repository?: Record<string, string>;
  exports?: Record<string, unknown>;
} & Partial<
  Record<(typeof DEPENDENCY_SECTIONS)[number], Record<string, string>>
>;

function exec(file: string, args: string[], cwd: string) {
  try {
    return execFileSync(file, args, {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      env: { ...process.env, NODE_PATH: "" },
    });
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
      { cause: error }
    );
  }
}

function readManifest(dir: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
}

/** Directories of the workspace packages that are not private. */
function publishableDirs() {
  return fs
    .readdirSync(packagesRoot)
    .filter(
      (dir) =>
        fs.existsSync(path.join(packagesRoot, dir, "package.json")) &&
        !readManifest(path.join(packagesRoot, dir)).private
    );
}

/** The directory the tarballs are packed into; kept when set by the caller. */
function tarballsDir() {
  const retained = process.env.AYME_PACKED_DIR;
  if (!retained) return path.join(tmp, "tarballs");
  const dir = path.resolve(retained);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.readdirSync(dir).length > 0)
    throw new Error(`AYME_PACKED_DIR must be empty: ${dir}`);
  return dir;
}

/** Versions of the workspace packages, keyed by package name. */
function workspaceVersions() {
  const versions = new Map<string, string>();
  for (const dir of fs.readdirSync(packagesRoot)) {
    if (!fs.existsSync(path.join(packagesRoot, dir, "package.json"))) continue;
    const { name, version } = readManifest(path.join(packagesRoot, dir));
    versions.set(name, version);
  }
  return versions;
}

function localPathPatterns() {
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tmp = os.tmpdir();
  return [
    ...[...new Set([repoRoot, tmp, fs.realpathSync(tmp)])].map(
      (value) => new RegExp(`${escape(value)}(?![\\w.-])`)
    ),
    /\/Users\//,
    /\/home\//,
    // A drive letter must not follow an identifier character, so URL
    // protocols such as `file:` pass.
    /(?<![\w$])[A-Za-z]:\\{1,2}[\w .-]+\\/,
    // A forward-slash drive path must start a string or word, so object keys
    // such as `{a:/re/}` pass.
    /(?<=^|["'`\s])[A-Za-z]:\/[^\s/"'`]+\//m,
  ];
}

/**
 * Reports publication leaks in an extracted package: non-registry
 * dependency specifiers, internal dependencies that do not pin the sibling's
 * version, and absolute local paths in any packed file.
 */
function findPublicationLeaks(
  packageDir: string,
  versions: Map<string, string>
): string[] {
  const leaks: string[] = [];
  const manifest = readManifest(packageDir);
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      const sibling = versions.get(name);
      if (/^(workspace|link|file):/.test(specifier))
        leaks.push(`${section}.${name}: ${specifier}`);
      else if (sibling !== undefined && specifier !== sibling)
        leaks.push(
          `${section}.${name}: ${specifier} is not the sibling version ${sibling}`
        );
    }
  }
  const patterns = localPathPatterns();
  for (const entry of fs.readdirSync(packageDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const contents = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      const match = pattern.exec(contents);
      if (match)
        leaks.push(
          `${path.relative(packageDir, file)}: local path ${match[0]}`
        );
    }
  }
  return leaks;
}

let tmp = "";
/** Tarball and extracted package directory, keyed by package name. */
const packed: Record<string, { tarball: string; dir: string }> = {};

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ayme-packed-"));
  const tarballs = tarballsDir();
  for (const name of PUBLISHED_PACKAGES) {
    const root = path.join(packagesRoot, name);
    const staging = path.join(tmp, "staging", name);
    fs.mkdirSync(staging, { recursive: true });
    for (const file of ["package.json", "README.md", "LICENSE"])
      fs.copyFileSync(path.join(root, file), path.join(staging, file));
    // Published files other than the build, such as Angular's schematics.
    const { files = [] } = readManifest(root) as { files?: string[] };
    for (const entry of files.filter((entry) => entry !== "dist"))
      fs.cpSync(path.join(root, entry), path.join(staging, entry), {
        recursive: true,
      });
    // pnpm pack reads the versions for `workspace:` from linked siblings.
    fs.symlinkSync(
      path.join(root, "node_modules"),
      path.join(staging, "node_modules"),
      "junction"
    );
    exec(
      "pnpm",
      ["exec", "tsdown", "--out-dir", path.join(staging, "dist")],
      root
    );
    const { filename } = JSON.parse(
      exec("pnpm", ["pack", "--json", "--pack-destination", tarballs], staging)
    ) as { filename: string };
    const extracted = path.join(tmp, "extracted", name);
    fs.mkdirSync(extracted, { recursive: true });
    exec("tar", ["xzf", filename, "-C", extracted], tmp);
    packed[readManifest(root).name] = {
      tarball: filename,
      dir: path.join(extracted, "package"),
    };
  }
}, 240_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** Consumer dependencies and overrides that resolve to the packed tarballs. */
function tarballDependencies(names: string[]) {
  const tarballs = Object.fromEntries(
    names.map((name) => [name, `file:${packed[name]!.tarball}`])
  );
  const workspaceYaml = `overrides:\n${Object.entries(tarballs)
    .map(([name, tarball]) => `  '${name}': '${tarball}'`)
    .join("\n")}\n`;
  return { tarballs, workspaceYaml };
}

it("every publishable package is packed, all with one shared version", () => {
  expect(publishableDirs().sort()).toEqual([...PUBLISHED_PACKAGES].sort());
  const versions = Object.values(packed).map(
    ({ dir }) => readManifest(dir).version
  );
  expect(versions).toHaveLength(PUBLISHED_PACKAGES.length);
  expect(new Set(versions).size).toBe(1);
});

it("packed manifests name this repository, as npm provenance requires", () => {
  for (const name of PUBLISHED_PACKAGES)
    expect(readManifest(packed[`@ayme-dev/${name}`]!.dir).repository).toEqual({
      type: "git",
      url: "git+https://github.com/ayme-labs/ayme.git",
      directory: `packages/${name}`,
    });
});

it("packed packages contain no workspace references or local paths", () => {
  const versions = workspaceVersions();
  for (const [name, { dir }] of Object.entries(packed))
    expect(findPublicationLeaks(dir, versions), name).toEqual([]);
});

it("the leak check reports non-registry specifiers and local paths", () => {
  const fixture = path.join(tmp, "leaky");
  fs.mkdirSync(path.join(fixture, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({
      name: "@ayme-dev/leaky",
      version: "0.1.0",
      dependencies: { "@ayme-dev/ayme": "workspace:*", a: "link:../a" },
      devDependencies: { b: "file:../b" },
      peerDependencies: { "@ayme-dev/vue": "^0.0.1" },
    })
  );
  fs.writeFileSync(
    path.join(fixture, "dist", "index.mjs"),
    'const url = "file:///x"; const re = {a:/b/}; export const p = "/home/ci";\n' +
      'export const q = "D:/agent/_work/pkg";\n'
  );
  fs.writeFileSync(
    path.join(fixture, "dist", "win.mjs"),
    'export const p = "C:\\\\Users\\\\ci";\n'
  );
  const leaks = findPublicationLeaks(
    fixture,
    new Map([
      ["@ayme-dev/ayme", "0.1.0"],
      ["@ayme-dev/vue", "0.1.0"],
    ])
  );
  expect(leaks).toEqual([
    "dependencies.@ayme-dev/ayme: workspace:*",
    "dependencies.a: link:../a",
    "devDependencies.b: file:../b",
    "peerDependencies.@ayme-dev/vue: ^0.0.1 is not the sibling version 0.1.0",
    "dist/index.mjs: local path /home/",
    "dist/index.mjs: local path D:/agent/",
    expect.stringMatching(/^dist\/win\.mjs: local path C:/),
  ]);
});

it(
  "a clean consumer installs every packed package and imports every export",
  { timeout: 120_000 },
  () => {
    const consumer = path.join(tmp, "all-exports");
    fs.mkdirSync(consumer);
    const { tarballs, workspaceYaml } = tarballDependencies(
      Object.keys(packed)
    );
    fs.writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "ayme-all-exports-consumer",
        private: true,
        type: "module",
        dependencies: {
          ...tarballs,
          react: "19.2.8",
          svelte: "5.57.1",
          vue: "3.5.42",
          "@angular/core": "22.2.1",
          rxjs: "7.8.2",
        },
      })
    );
    fs.writeFileSync(path.join(consumer, "pnpm-workspace.yaml"), workspaceYaml);
    exec("pnpm", ["install", "--ignore-scripts", "--no-lockfile"], consumer);
    const specifiers = Object.entries(packed).flatMap(([name, { dir }]) =>
      Object.keys(readManifest(dir).exports ?? {})
        // A manifest export, for tools like the Angular CLI, is not a module.
        .filter((subpath) => subpath !== "./package.json")
        .map((subpath) => path.posix.join(name, subpath))
    );
    expect(specifiers).toEqual(
      expect.arrayContaining([
        "@ayme-dev/angular",
        "@ayme-dev/unplugin-ayme/vite",
        "@ayme-dev/unplugin-ayme/turbopack-loader",
        "@ayme-dev/unplugin-ayme/angular",
      ])
    );
    fs.writeFileSync(
      path.join(consumer, "check.mjs"),
      `for (const specifier of ${JSON.stringify(specifiers)}) {
  const module = await import(specifier);
  if (Object.keys(module).length === 0) throw new Error(specifier + " exports nothing");
}
console.log("ok");
`
    );
    expect(exec(process.execPath, ["check.mjs"], consumer).trim()).toBe("ok");
  }
);

it(
  "packed packages support consumer Playwright types and conditional config loading",
  { timeout: 180_000 },
  () => {
    // Only core declares the optional peer; the inspector requires it.
    for (const name of [
      "ayme",
      "vue",
      "react",
      "svelte",
      "angular",
      "inspector",
      "unplugin-ayme",
    ]) {
      const manifest = readManifest(path.join(packagesRoot, name));
      expect(manifest.peerDependencies?.["@playwright/test"]).toBe(
        ["ayme", "inspector"].includes(name) ? ">=1.29 <1.63" : undefined
      );
      expect(
        (
          manifest as {
            peerDependenciesMeta?: Record<string, { optional?: boolean }>;
          }
        ).peerDependenciesMeta?.["@playwright/test"]?.optional
      ).toBe(name === "ayme" ? true : undefined);
    }
    const { tarballs, workspaceYaml } = tarballDependencies([
      "@ayme-dev/ayme",
      "@ayme-dev/vue",
      "@ayme-dev/svelte",
      "@ayme-dev/inspector",
      "@ayme-dev/unplugin-ayme",
    ]);

    for (const version of [undefined, "1.29.0", "1.62.1"]) {
      const consumer = path.join(tmp, version ?? "without-playwright");
      fs.mkdirSync(consumer);
      fs.writeFileSync(
        path.join(consumer, "package.json"),
        JSON.stringify({
          name: "ayme-peer-consumer",
          private: true,
          type: "module",
          dependencies: tarballs,
          devDependencies: {
            // Playwright 1.29 uses namespace syntax removed in TypeScript 6.
            typescript: version === "1.29.0" ? "5.9.3" : "6.0.3",
            "@types/node": "24.13.3",
            vue: "3.5.42",
            svelte: "5.57.1",
            vite: "8.0.0",
            ...(version ? { "@playwright/test": version } : {}),
          },
        })
      );
      fs.writeFileSync(
        path.join(consumer, "pnpm-workspace.yaml"),
        workspaceYaml
      );
      exec(
        "pnpm",
        [
          "install",
          "--ignore-scripts",
          "--no-lockfile",
          "--strict-peer-dependencies",
        ],
        consumer
      );
      fs.writeFileSync(
        path.join(consumer, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            experimentalDecorators: true,
            skipLibCheck: false,
            noEmit: true,
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            types: ["node"],
          },
          files: ["consumer.ts"],
        })
      );
      fs.writeFileSync(
        path.join(consumer, "consumer.ts"),
        `
import { ayme } from '@ayme-dev/ayme';
import { mountInspector } from '@ayme-dev/inspector';
void [ayme, mountInspector];
@ayme({ description: 'A described page.' })
class DescribedPom {
  @ayme.action
  open() {}
}
@ayme
class BarePom {
  @ayme.action({ description: 'Close the page.' })
  close() {}
}
void [DescribedPom, BarePom];
${
  version
    ? `
import type { BrowserContext, Page, Locator } from '@playwright/test';
import { createAyme, type ActionResult } from '@ayme-dev/ayme';
import type { PageObjectConstructor } from '@ayme-dev/ayme/internal';
import { usePageObject } from '@ayme-dev/vue';
import { usePageObject as useSveltePageObject } from '@ayme-dev/svelte';
@ayme
class Pom {
  readonly input: Locator;
  constructor(page: Page) { this.input = page.getByRole('textbox', { name: 'Name' }); }
  @ayme.action({ description: 'Fill and submit the input.' })
  async act(value: string) {
    await this.input.fill(value, { timeout: 10 });
    await this.input.press('Enter');
    const items: Locator[] = await this.input.all();
    await items[0]?.waitFor({ state: 'hidden', timeout: 10 });
  }
}
const ctor: PageObjectConstructor<Pom> = Pom;
const instance: Pom = usePageObject(ctor);
const svelteInstance: Pom = useSveltePageObject(ctor);
const session = createAyme();
const registered: Pom = session.pom.register(ctor);
const clicked: Promise<ActionResult> = session.tools.run('click', { target: 'e1' });
void [instance, svelteInstance, registered, clicked];
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
  waitForPublishedTool,
  type PublishedTool,
  type RecordingDriver,
} from '@ayme-dev/ayme/testing';
export async function recordAndRun(context: BrowserContext, page: Page): Promise<unknown> {
  await recordPublishedTools(context);
  await waitForPublishedTool(page, 'Pom.act', { timeout: 10 });
  const names: string[] = await publishedToolNames(page);
  const schema = await publishedToolSchema(page, names[0]!);
  const driver: RecordingDriver = { tools: [] as PublishedTool[] };
  void [schema?.inputSchema, driver];
  return executePublishedTool(page, 'Pom.act', { value: 'x' });
}
`
    : ""
}
`
      );
      exec("pnpm", ["exec", "tsc", "--pretty", "false"], consumer);
      fs.writeFileSync(
        path.join(consumer, "playwright.config.ts"),
        "export default { use: { testIdAttribute: 'data-config', actionTimeout: 17 } };\n"
      );
      fs.writeFileSync(
        path.join(consumer, "check.mjs"),
        `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unpluginFactory } from '@ayme-dev/unplugin-ayme';
const resolveSettings = async (playwright) => {
  const plugin = unpluginFactory({ playwright }, { framework: 'vite' });
  return plugin.vite.config({ root: process.cwd() });
};
const defaults = await resolveSettings(undefined);
assert.equal(defaults.define.__AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__, '"data-testid"');
const direct = await resolveSettings({ use: { testIdAttribute: 'data-direct', actionTimeout: 9 } });
assert.equal(direct.define.__AYME_PLAYWRIGHT_ACTION_TIMEOUT__, '9');
${
  version
    ? `
const plugin = unpluginFactory({}, { framework: 'vite' });
const sourcePath = resolve('consumer.ts');
const transformed = await plugin.transform.handler(readFileSync(sourcePath, 'utf8'), sourcePath);
assert.ok(transformed, 'Decorated POM must produce registration metadata');
const registration = transformed.code.split('\\n').find(line => line.startsWith('registerCompiledPom(Pom, '));
assert.ok(registration, 'Transformed POM must register its compiled manifest');
const manifest = JSON.parse(registration.slice('registerCompiledPom(Pom, '.length, -2));
assert.deepEqual(manifest.members, [{ memberName: 'input', kind: 'locator', access: 'field' }]);
assert.deepEqual(manifest.tools, [{
  methodName: 'act',
  toolName: 'Pom.act',
  description: 'Fill and submit the input.',
  authoredDescription: 'Fill and submit the input.',
  inputSchema: {
    type: 'object', properties: { value: { type: 'string' } },
    required: ['value'], additionalProperties: false,
  },
  parameters: [{ name: 'value', optional: false, schema: { type: 'string' } }],
}]);
`
    : ""
}
${
  version === "1.62.1"
    ? `
const loaded = await resolveSettings({ config: './playwright.config.ts' });
assert.equal(loaded.define.__AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__, '"data-config"');
assert.equal(loaded.define.__AYME_PLAYWRIGHT_ACTION_TIMEOUT__, '17');
`
    : version
      ? `
await assert.rejects(resolveSettings({ config: './playwright.config.ts' }), /could not resolve the consumer's playwright package/);
`
      : `
assert.throws(() => createRequire(import.meta.url).resolve('@playwright/test/package.json'), /Cannot find module/);
`
}
`
      );
      exec(process.execPath, ["check.mjs"], consumer);
    }
  }
);

// The floors of the plugin's Vite peer range.
for (const vite of ["7.0.0", "8.0.0"])
  it(
    `a packed Vite config type-checks its library declarations with Vite ${vite} alone`,
    { timeout: 120_000 },
    () => {
      const consumer = path.join(tmp, `vite-${vite}-consumer`);
      fs.mkdirSync(consumer);
      const { tarballs, workspaceYaml } = tarballDependencies([
        "@ayme-dev/ayme",
        "@ayme-dev/inspector",
        "@ayme-dev/unplugin-ayme",
      ]);
      fs.writeFileSync(
        path.join(consumer, "package.json"),
        JSON.stringify({
          name: "ayme-vite-consumer",
          private: true,
          type: "module",
          dependencies: tarballs,
          // Vite's own declarations import Node's.
          devDependencies: {
            typescript: "6.0.3",
            "@types/node": "24.13.3",
            vite,
          },
        })
      );
      fs.writeFileSync(
        path.join(consumer, "pnpm-workspace.yaml"),
        workspaceYaml
      );
      exec(
        "pnpm",
        [
          "install",
          "--ignore-scripts",
          "--no-lockfile",
          "--strict-peer-dependencies",
        ],
        consumer
      );
      fs.writeFileSync(
        path.join(consumer, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            skipLibCheck: false,
            noEmit: true,
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            types: ["node"],
          },
          files: ["vite.config.ts"],
        })
      );
      fs.writeFileSync(
        path.join(consumer, "vite.config.ts"),
        `
import { defineConfig, type Plugin } from 'vite';
import aymeDefault, { ayme, type AymeOptions } from '@ayme-dev/unplugin-ayme/vite';
import turbopackLoader from '@ayme-dev/unplugin-ayme/turbopack-loader';
const options: AymeOptions = { playwright: { use: { testIdAttribute: 'data-id' } } };
const plugin: Plugin = ayme(options);
void turbopackLoader;
export default defineConfig({ plugins: [plugin, aymeDefault()] });
`
      );
      exec("pnpm", ["exec", "tsc", "--pretty", "false"], consumer);
      const viteDeclarations = fs.readFileSync(
        path.join(packed["@ayme-dev/unplugin-ayme"]!.dir, "dist", "vite.d.mts"),
        "utf8"
      );
      expect(viteDeclarations).not.toContain("unplugin");
    }
  );

it(
  "packed Angular packages type-check in a consumer on Angular 19.0 and TypeScript 5.5",
  { timeout: 120_000 },
  () => {
    const consumer = path.join(tmp, "angular-consumer");
    fs.mkdirSync(consumer);
    const { tarballs, workspaceYaml } = tarballDependencies([
      "@ayme-dev/ayme",
      "@ayme-dev/angular",
      "@ayme-dev/inspector",
      "@ayme-dev/unplugin-ayme",
    ]);
    fs.writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "ayme-angular-consumer",
        private: true,
        type: "module",
        dependencies: {
          ...tarballs,
          "@angular/core": "19.0.0",
          rxjs: "7.8.2",
        },
        devDependencies: {
          // The lowest TypeScript and esbuild Angular 19.0 supports.
          typescript: "5.5.4",
          esbuild: "0.24.0",
          // What the Angular CLI provides when it runs ng add.
          "@angular-devkit/schematics": "19.0.0",
          "@schematics/angular": "19.0.0",
          "@types/node": "22.10.10",
        },
      })
    );
    fs.writeFileSync(path.join(consumer, "pnpm-workspace.yaml"), workspaceYaml);
    exec(
      "pnpm",
      [
        "install",
        "--ignore-scripts",
        "--no-lockfile",
        "--strict-peer-dependencies",
      ],
      consumer
    );
    fs.writeFileSync(
      path.join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          experimentalDecorators: true,
          skipLibCheck: false,
          noEmit: true,
          target: "ES2022",
          lib: ["ES2022", "ESNext.Disposable", "DOM"],
          module: "preserve",
          moduleResolution: "bundler",
          types: ["node"],
        },
        files: ["consumer.ts"],
      })
    );
    fs.writeFileSync(
      path.join(consumer, "consumer.ts"),
      `
import type { ApplicationConfig } from '@angular/core';
import { ayme } from '@ayme-dev/ayme';
import {
  injectAyme,
  injectPageObject,
  provideAyme,
  type AymeOptions,
  type AymeSetup,
  type AymeWebMcpPublicationStatus,
} from '@ayme-dev/angular';
import aymeAngularPlugin, { aymeAngular, type AymeAngularOptions } from '@ayme-dev/unplugin-ayme/angular';
@ayme
class Pom {
  @ayme.action({ description: 'Act.' })
  act() {}
}
const options: AymeOptions = { webMCP: { enabled: true, toolNamePrefix: 'demo_' } };
export const appConfig: ApplicationConfig = { providers: [provideAyme(options)] };
export function inComponent() {
  const setup: AymeSetup = injectAyme();
  const status: AymeWebMcpPublicationStatus = setup.webMCP.publicationStatus();
  const retried: Promise<void> = setup.webMCP.retryPublication();
  const pom: Pom = injectPageObject(Pom);
  void [setup.ayme.tools.run, status.state, retried, pom.act()];
}
const pluginOptions: AymeAngularOptions = { tsconfigPath: 'tsconfig.app.json' };
const name: string = aymeAngularPlugin(pluginOptions).name + aymeAngular().name;
void name;
`
    );
    exec("pnpm", ["exec", "tsc", "--pretty", "false"], consumer);

    // `ng add` reads the collection the installed manifest names, then
    // requires its factory beside the CLI's schematics packages.
    fs.writeFileSync(
      path.join(consumer, "load-ng-add.cjs"),
      `const fs = require("node:fs");
const path = require("node:path");
const manifestPath = require.resolve("@ayme-dev/angular/package.json");
const collectionPath = path.resolve(path.dirname(manifestPath), require(manifestPath).schematics);
const ngAdd = JSON.parse(fs.readFileSync(collectionPath, "utf8")).schematics["ng-add"];
const [factory, name] = ngAdd.factory.split("#");
if (!fs.existsSync(path.resolve(path.dirname(collectionPath), ngAdd.schema))) throw new Error("ng-add schema missing");
if (typeof require(path.resolve(path.dirname(collectionPath), factory))[name] !== "function") throw new Error("ng-add factory missing");
console.log("ok");
`
    );
    expect(exec(process.execPath, ["load-ng-add.cjs"], consumer).trim()).toBe(
      "ok"
    );
  }
);

const POM_SOURCE = `
import type { Locator, Page } from '@playwright/test';
import { ayme } from '@ayme-dev/ayme';
@ayme
export class Pom {
  readonly button: Locator;
  constructor(page: Page) { this.button = page.getByRole('button', { name: 'Count' }); }
  @ayme.action({ description: 'Count once.' })
  async count() { await this.button.click(); }
}
`;

// Floors from the adapters' peer ranges. Vue 3.2.0–3.2.38 declarations fail
// under skipLibCheck: false in Vue's own runtime-core.d.ts, so its declaration
// floor is 3.2.39; the Vue compatibility lane covers the 3.2.0 runtime.
const FRAMEWORK_FLOORS = [
  {
    adapter: "@ayme-dev/react",
    framework: "React 18.0.0",
    dependencies: {
      react: "18.0.0",
      "react-dom": "18.0.0",
      "@types/react": "18.3.31",
      "@types/react-dom": "18.3.7",
    },
    source: `
import { createElement } from 'react';
import { AymeProvider, useAyme, usePageObject } from '@ayme-dev/react';
import { Pom } from './pom.js';
function Counter() {
  const pom: Pom = usePageObject(Pom);
  const { webMCP } = useAyme();
  return createElement('button', { onClick: () => void pom.count() }, webMCP.publicationStatus.state);
}
export const app = createElement(AymeProvider, { webMCP: { enabled: true } }, createElement(Counter));
// @ts-expect-error pageFactory must return a Page.
createElement(AymeProvider, { pageFactory: () => 42 });
`,
  },
  {
    adapter: "@ayme-dev/vue",
    framework: "Vue 3.2.39",
    dependencies: { vue: "3.2.39", "@vue/server-renderer": "3.2.39" },
    source: `
import { defineComponent, h } from 'vue';
import { AymeProvider, useAyme, usePageObject } from '@ayme-dev/vue';
import { Pom } from './pom.js';
const Counter = defineComponent({
  setup() {
    const pom: Pom = usePageObject(Pom);
    const { webMCP } = useAyme();
    return () => h('button', { onClick: () => void pom.count() }, webMCP.publicationStatus.state);
  },
});
export const app = h(AymeProvider, { webMCP: { enabled: true } }, () => h(Counter));
// @ts-expect-error webMCP is an options object.
h(AymeProvider, { webMCP: 'on' });
`,
  },
  {
    adapter: "@ayme-dev/svelte",
    framework: "Svelte 3.54.0",
    dependencies: { svelte: "3.54.0" },
    source: `
import { get } from 'svelte/store';
import { useAyme, usePageObject } from '@ayme-dev/svelte';
import { Pom } from './pom.js';
export function root() {
  const { webMCP } = useAyme({ webMCP: { enabled: true } });
  return get(webMCP.publicationStatus).state;
}
export function counter() {
  const pom: Pom = usePageObject(Pom);
  return () => pom.count();
}
`,
  },
];

for (const floor of FRAMEWORK_FLOORS)
  it(
    `packed ${floor.adapter} type-checks in a consumer on ${floor.framework}`,
    { timeout: 120_000 },
    () => {
      const consumer = path.join(
        tmp,
        `${floor.adapter.replace("@ayme-dev/", "")}-floor-consumer`
      );
      fs.mkdirSync(consumer);
      const { tarballs, workspaceYaml } = tarballDependencies([
        "@ayme-dev/ayme",
        floor.adapter,
      ]);
      fs.writeFileSync(
        path.join(consumer, "package.json"),
        JSON.stringify({
          name: "ayme-floor-consumer",
          private: true,
          type: "module",
          dependencies: { ...tarballs, ...floor.dependencies },
          devDependencies: {
            typescript: "6.0.3",
            "@playwright/test": "1.62.1",
            "@types/node": "24.13.3",
          },
        })
      );
      fs.writeFileSync(
        path.join(consumer, "pnpm-workspace.yaml"),
        workspaceYaml
      );
      exec(
        "pnpm",
        [
          "install",
          "--ignore-scripts",
          "--no-lockfile",
          "--strict-peer-dependencies",
        ],
        consumer
      );
      fs.writeFileSync(
        path.join(consumer, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            experimentalDecorators: true,
            skipLibCheck: false,
            noEmit: true,
            target: "ES2022",
            lib: ["ES2022", "DOM"],
            module: "preserve",
            moduleResolution: "bundler",
            types: ["node"],
          },
          files: ["pom.ts", "consumer.ts"],
        })
      );
      fs.writeFileSync(path.join(consumer, "pom.ts"), POM_SOURCE);
      fs.writeFileSync(path.join(consumer, "consumer.ts"), floor.source);
      exec("pnpm", ["exec", "tsc", "--pretty", "false"], consumer);
    }
  );

it(
  "packed @ayme-dev/ayme contains no private workspace leaks and is importable",
  { timeout: 60_000 },
  () => {
    const packageDir = packed["@ayme-dev/ayme"]!.dir;
    const packedPkg = readManifest(packageDir);
    const distDir = path.join(packageDir, "dist");
    const notices = fs.readFileSync(
      path.join(distDir, "THIRD_PARTY_NOTICES.txt"),
      "utf8"
    );
    expect(notices).toBe(
      fs.readFileSync(path.join(aymeRoot, "THIRD_PARTY_NOTICES.txt"), "utf8")
    );
    expect(notices).toContain("Apache License");
    expect(notices).toContain("Version 2.0, January 2004");
    expect(notices).toContain("Microsoft");

    // ── Assert: manifest has no private deps ────────────────────────
    const exposed: string[] = [];
    for (const section of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ] as const) {
      for (const name of Object.keys(packedPkg[section] ?? {})) {
        if (PRIVATE_PACKAGES.includes(name)) {
          exposed.push(`${section}: ${name}`);
        }
      }
    }
    expect(exposed, "private packages leaked into packed manifest").toEqual([]);

    // ── Assert: dist artifacts contain no private package references ──
    const textualFiles = fs
      .readdirSync(distDir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.endsWith(".mjs") || entry.name.endsWith(".d.mts"))
      )
      .map((entry) =>
        path.relative(distDir, path.join(entry.parentPath, entry.name))
      );
    const hits: string[] = [];
    for (const relPath of textualFiles) {
      const contents = fs.readFileSync(path.join(distDir, relPath), "utf-8");
      for (const pkg of PRIVATE_PACKAGES) {
        if (contents.includes(pkg)) {
          hits.push(`${relPath}: ${pkg}`);
        }
      }
    }
    expect(hits, "private package references in dist artifacts").toEqual([]);

    // ── Assert: consumer can install and import ─────────────────────
    const consumerDir = path.join(tmp, "webmcp-consumer");
    fs.mkdirSync(consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, "package.json"),
      JSON.stringify({
        name: "consumer",
        type: "module",
        version: "0.0.0",
        dependencies: tarballDependencies(["@ayme-dev/ayme"]).tarballs,
      })
    );
    exec("pnpm", ["install", "--ignore-scripts", "--no-lockfile"], consumerDir);

    const checkFile = path.join(consumerDir, "check.mjs");
    fs.writeFileSync(
      checkFile,
      [
        'const main = await import("@ayme-dev/ayme");',
        'const internal = await import("@ayme-dev/ayme/internal");',
        'if (typeof main.ayme !== "function" || typeof main.ayme.action !== "function") throw new Error("missing the ayme decorators");',
        'if ("WebMCP" in main) throw new Error("WebMCP must not be exported");',
        'if ("default" in main || "getPageState" in main.ayme) throw new Error("the helper object must not be on the main entry");',
        'if (typeof main.createPage !== "function") throw new Error("missing createPage");',
        'if (typeof main.createAyme !== "function") throw new Error("missing createAyme");',
        'if ("createAyme" in internal) throw new Error("createAyme must not be on /internal");',
        'if (typeof internal.configureAymeRuntime !== "function") throw new Error("missing configureAymeRuntime");',
        'const testing = await import("@ayme-dev/ayme/testing");',
        'const testingExports = ["executePublishedTool", "publishedToolNames", "publishedToolSchema", "recordPublishedTools", "recordPublishedToolsLate", "waitForPublishedTool"];',
        'if (JSON.stringify(Object.keys(testing).sort()) !== JSON.stringify(testingExports)) throw new Error("unexpected /testing exports: " + Object.keys(testing));',
        'if ("recordPublishedTools" in main || "recordPublishedTools" in internal) throw new Error("the recording driver must stay on /testing");',
        'console.log("ok");',
      ].join("\n")
    );

    const result = exec(process.execPath, [checkFile], consumerDir);
    expect(result.trim()).toBe("ok");
  }
);
