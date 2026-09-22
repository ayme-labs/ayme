/**
 * Packed-consumer regression for the publishable WebMCP packages.
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
 * 4. The packed @ayme-dev/webmcp does not expose private workspace packages.
 * 5. Consumers type-check and load config with and without Playwright.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const webmcpRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packagesRoot = path.dirname(webmcpRoot);
const repoRoot = path.dirname(packagesRoot);

const PUBLISHED_PACKAGES = [
  "webmcp",
  "webmcp-inspector",
  "webmcp-vue",
  "webmcp-react",
  "unplugin-webmcp",
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
    // protocols such as `file:` and object keys such as `{a:/re/}` pass.
    /(?<![\w$])[A-Za-z]:(?:\\{1,2}[\w .-]+\\|\/(?:Users|Windows|Program Files)\/)/,
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
  for (const name of PUBLISHED_PACKAGES) {
    const root = path.join(packagesRoot, name);
    const staging = path.join(tmp, "staging", name);
    fs.mkdirSync(staging, { recursive: true });
    for (const file of ["package.json", "README.md", "LICENSE"])
      fs.copyFileSync(path.join(root, file), path.join(staging, file));
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
      exec(
        "pnpm",
        ["pack", "--json", "--pack-destination", path.join(tmp, "tarballs")],
        staging
      )
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

it("packed packages contain no workspace references or local paths", () => {
  const versions = workspaceVersions();
  expect(Object.keys(packed)).toHaveLength(PUBLISHED_PACKAGES.length);
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
      dependencies: { "@ayme-dev/webmcp": "workspace:*", a: "link:../a" },
      devDependencies: { b: "file:../b" },
      peerDependencies: { "@ayme-dev/webmcp-vue": "^0.0.1" },
    })
  );
  fs.writeFileSync(
    path.join(fixture, "dist", "index.mjs"),
    'const url = "file:///x"; const re = {a:/b/}; export const p = "/home/ci";\n'
  );
  fs.writeFileSync(
    path.join(fixture, "dist", "win.mjs"),
    'export const p = "C:\\\\Users\\\\ci";\n'
  );
  const leaks = findPublicationLeaks(
    fixture,
    new Map([
      ["@ayme-dev/webmcp", "0.1.0"],
      ["@ayme-dev/webmcp-vue", "0.1.0"],
    ])
  );
  expect(leaks).toEqual([
    "dependencies.@ayme-dev/webmcp: workspace:*",
    "dependencies.a: link:../a",
    "devDependencies.b: file:../b",
    "peerDependencies.@ayme-dev/webmcp-vue: ^0.0.1 is not the sibling version 0.1.0",
    "dist/index.mjs: local path /home/",
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
        dependencies: { ...tarballs, react: "19.2.8", vue: "3.5.42" },
      })
    );
    fs.writeFileSync(path.join(consumer, "pnpm-workspace.yaml"), workspaceYaml);
    exec("pnpm", ["install", "--ignore-scripts", "--no-lockfile"], consumer);
    const specifiers = Object.entries(packed).flatMap(([name, { dir }]) =>
      Object.keys(readManifest(dir).exports ?? {}).map((subpath) =>
        path.posix.join(name, subpath)
      )
    );
    expect(specifiers).toEqual(
      expect.arrayContaining([
        "@ayme-dev/unplugin-webmcp/vite",
        "@ayme-dev/unplugin-webmcp/turbopack-loader",
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
    for (const name of [
      "webmcp",
      "webmcp-vue",
      "webmcp-inspector",
      "unplugin-webmcp",
    ]) {
      const manifest = readManifest(path.join(packagesRoot, name));
      expect(manifest.peerDependencies?.["@playwright/test"]).toBe(
        name === "unplugin-webmcp" ? undefined : ">=1.29 <1.63"
      );
      expect(
        (
          manifest as {
            peerDependenciesMeta?: Record<string, { optional?: boolean }>;
          }
        ).peerDependenciesMeta?.["@playwright/test"]?.optional
      ).toBe(["webmcp", "webmcp-vue"].includes(name) ? true : undefined);
    }
    const { tarballs, workspaceYaml } = tarballDependencies([
      "@ayme-dev/webmcp",
      "@ayme-dev/webmcp-vue",
      "@ayme-dev/webmcp-inspector",
      "@ayme-dev/unplugin-webmcp",
    ]);

    for (const version of [undefined, "1.29.1", "1.62.1"]) {
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
            typescript: version === "1.29.1" ? "5.9.3" : "6.0.3",
            "@types/node": "24.13.3",
            vue: "3.5.42",
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
import { ayme, WebMCP } from '@ayme-dev/webmcp';
import { mountInspector } from '@ayme-dev/webmcp-inspector';
void [ayme, WebMCP, mountInspector];
${
  version
    ? `
import type { Page, Locator } from '@playwright/test';
import { createPageRegistration, type PageObjectConstructor } from '@ayme-dev/webmcp/internal';
import { usePageObject } from '@ayme-dev/webmcp-vue';
@WebMCP
class Pom {
  readonly input: Locator;
  constructor(page: Page) { this.input = page.getByRole('textbox', { name: 'Name' }); }
  @WebMCP.tool({ description: 'Fill and submit the input.' })
  async act(value: string) {
    await this.input.fill(value, { timeout: 10 });
    await this.input.press('Enter');
    const items: Locator[] = await this.input.all();
    await items[0]?.waitFor({ state: 'hidden', timeout: 10 });
  }
}
const ctor: PageObjectConstructor<Pom> = Pom;
const instance: Pom = usePageObject(ctor);
createPageRegistration(ctor);
void instance;
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
import { unpluginFactory } from '@ayme-dev/unplugin-webmcp';
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

it(
  "packed @ayme-dev/webmcp contains no private workspace leaks and is importable",
  { timeout: 60_000 },
  () => {
    const packageDir = packed["@ayme-dev/webmcp"]!.dir;
    const packedPkg = readManifest(packageDir);
    const distDir = path.join(packageDir, "dist");
    const notices = fs.readFileSync(
      path.join(distDir, "THIRD_PARTY_NOTICES.txt"),
      "utf8"
    );
    expect(notices).toBe(
      fs.readFileSync(path.join(webmcpRoot, "THIRD_PARTY_NOTICES.txt"), "utf8")
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
        dependencies: tarballDependencies(["@ayme-dev/webmcp"]).tarballs,
      })
    );
    exec("pnpm", ["install", "--ignore-scripts", "--no-lockfile"], consumerDir);

    const checkFile = path.join(consumerDir, "check.mjs");
    fs.writeFileSync(
      checkFile,
      [
        'const main = await import("@ayme-dev/webmcp");',
        'const internal = await import("@ayme-dev/webmcp/internal");',
        'if (typeof main.ayme?.getPageState !== "function") throw new Error("missing named Ayme facade");',
        'if (main.default !== main.ayme) throw new Error("Ayme default differs from named export");',
        'if (typeof main.WebMCP !== "function") throw new Error("missing WebMCP");',
        'if (typeof internal.configureAymeRuntime !== "function") throw new Error("missing configureAymeRuntime");',
        'console.log("ok");',
      ].join("\n")
    );

    const result = exec(process.execPath, [checkFile], consumerDir);
    expect(result.trim()).toBe("ok");
  }
);
