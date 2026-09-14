/**
 * Packed-consumer regression: verifies the full packed-consumer boundary
 * for @ayme-dev/webmcp.
 *
 * 1. The packed manifest must not expose private workspace packages
 *    (@ayme-dev/playwright-browser, @ayme-dev/structural-observation)
 *    as runtime, optional, or peer dependencies.
 * 2. The dist output must not contain unresolved bare imports to them.
 * 3. A temporary consumer project can install the tarball and import
 *    both the public and internal entry points.
 *
 * The build runs into an isolated staging directory so it never mutates
 * the shared workspace `packages/webmcp/dist` that parallel tests read.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const webmcpRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const PRIVATE_PACKAGES = [
  "@ayme-dev/playwright-browser",
  "@ayme-dev/playwright-lite",
  "@ayme-dev/structural-observation",
];

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

it(
  "packed packages support consumer Playwright types and conditional config loading",
  { timeout: 180_000 },
  () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ayme-peers-"));
    try {
      const tarballs: Record<string, string> = {};
      for (const name of ["webmcp", "webmcp-vue", "unplugin-webmcp"]) {
        const root = path.resolve(webmcpRoot, "..", name);
        const staging = path.join(tmp, name);
        fs.mkdirSync(staging);
        const manifest = JSON.parse(
          fs.readFileSync(path.join(root, "package.json"), "utf8")
        );
        expect(manifest.peerDependencies?.["@playwright/test"]).toBe(
          name === "unplugin-webmcp" ? undefined : ">=1.29 <1.63"
        );
        expect(
          manifest.peerDependenciesMeta?.["@playwright/test"]?.optional
        ).toBe(name === "unplugin-webmcp" ? undefined : true);
        // Match pnpm pack's workspace:* publication conversion.
        if (manifest.dependencies?.["@ayme-dev/webmcp"])
          manifest.dependencies["@ayme-dev/webmcp"] = JSON.parse(
            fs.readFileSync(path.join(webmcpRoot, "package.json"), "utf8")
          ).version;
        fs.writeFileSync(
          path.join(staging, "package.json"),
          JSON.stringify(manifest)
        );
        exec(
          "pnpm",
          ["exec", "tsdown", "--out-dir", path.join(staging, "dist")],
          root
        );
        const filename = exec(
          "npm",
          ["pack", "--silent", "--pack-destination", tmp],
          staging
        ).trim();
        tarballs[`@ayme-dev/${name}`] = `file:${path.join(tmp, filename)}`;
      }

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
          `overrides:\n${Object.entries(tarballs)
            .map(([name, tarball]) => `  '${name}': '${tarball}'`)
            .join("\n")}\n`
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
void [ayme, WebMCP];
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
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
);

it(
  "packed @ayme-dev/webmcp contains no private workspace leaks and is importable",
  { timeout: 30_000 },
  () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webmcp-packed-"));
    try {
      // ── Build into isolated staging dir ───────────────────────────
      const stagingDir = path.join(tmpDir, "staging");
      const stagingDist = path.join(stagingDir, "dist");
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.copyFileSync(
        path.join(webmcpRoot, "package.json"),
        path.join(stagingDir, "package.json")
      );
      exec("pnpm", ["exec", "tsdown", "--out-dir", stagingDist], webmcpRoot);

      // ── Pack staging package ──────────────────────────────────────
      const packOutput = exec(
        "npm",
        ["pack", "--pack-destination", tmpDir],
        stagingDir
      );
      const tgzName = packOutput.trim().split("\n").pop()!;
      const tarball = path.isAbsolute(tgzName)
        ? tgzName
        : path.join(tmpDir, tgzName);
      expect(fs.existsSync(tarball)).toBe(true);

      // ── Extract ─────────────────────────────────────────────────────
      const extractDir = path.join(tmpDir, "extract");
      fs.mkdirSync(extractDir, { recursive: true });
      exec("tar", ["xzf", tarball, "-C", extractDir], tmpDir);

      const packedPkgPath = path.join(extractDir, "package", "package.json");
      const packedPkg = JSON.parse(fs.readFileSync(packedPkgPath, "utf-8"));
      const distDir = path.join(extractDir, "package", "dist");
      const notices = fs.readFileSync(
        path.join(distDir, "THIRD_PARTY_NOTICES.txt"),
        "utf8"
      );
      expect(notices).toBe(
        fs.readFileSync(
          path.join(webmcpRoot, "THIRD_PARTY_NOTICES.txt"),
          "utf8"
        )
      );
      expect(notices).toContain("Apache License");
      expect(notices).toContain("Version 2.0, January 2004");
      expect(notices).toContain("Microsoft");

      // ── Assert: manifest has no private deps ────────────────────────
      const depSections = [
        "dependencies",
        "optionalDependencies",
        "peerDependencies",
      ];
      const exposed: string[] = [];
      for (const section of depSections) {
        for (const name of Object.keys(
          (packedPkg[section] ?? {}) as Record<string, string>
        )) {
          if (PRIVATE_PACKAGES.includes(name)) {
            exposed.push(`${section}: ${name}`);
          }
        }
      }
      expect(exposed, "private packages leaked into packed manifest").toEqual(
        []
      );

      // ── Assert: dist artifacts contain no private package references ──
      const textualFiles = fs
        .readdirSync(distDir, { recursive: true, withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            (entry.name.endsWith(".mjs") || entry.name.endsWith(".d.mts"))
        )
        .map((entry) =>
          entry.parentPath === distDir
            ? entry.name
            : path.relative(distDir, path.join(entry.parentPath, entry.name))
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
      const consumerDir = path.join(tmpDir, "consumer");
      fs.mkdirSync(consumerDir, { recursive: true });
      fs.writeFileSync(
        path.join(consumerDir, "package.json"),
        JSON.stringify({
          name: "consumer",
          type: "module",
          version: "0.0.0",
          dependencies: { "@ayme-dev/webmcp": `file:${tarball}` },
        })
      );
      exec(
        "pnpm",
        ["install", "--ignore-scripts", "--no-lockfile"],
        consumerDir
      );

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
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
);
