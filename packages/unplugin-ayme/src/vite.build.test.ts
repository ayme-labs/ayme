import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "vite";
import { expect, it, vi } from "vitest";

const { createPomProgram } = vi.hoisted(() => ({
  createPomProgram: vi.fn(),
}));

vi.mock("./pomProgram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pomProgram")>();
  createPomProgram.mockImplementation(actual.createPomProgram);
  return { ...actual, createPomProgram };
});

import { ayme } from "./vite";

// Integration: the Page Object Model modules of one tsconfig project share a
// Program for the length of a Vite build (ADR-0036).

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}.ts`, import.meta.url));

it("builds one Program per tsconfig project and build", async () => {
  const plugin = ayme({ include: true, report: "none" });
  const buildBoth = () =>
    build({
      configFile: false,
      logLevel: "silent",
      plugins: [plugin],
      build: {
        write: false,
        rolldownOptions: {
          input: [fixture("annotatedChildrenPom"), fixture("twoPagesPom")],
          external: [/^@ayme-dev\//, /^@playwright\//],
        },
      },
    });
  createPomProgram.mockClear();

  await buildBoth();
  expect(createPomProgram).toHaveBeenCalledTimes(1);

  // The cache ends with the build.
  await buildBoth();
  expect(createPomProgram).toHaveBeenCalledTimes(2);
}, 30_000);

// Integration on the built packages: a build without Ayme, which every build
// is unless it says `include: true`, ships none of the runtime and none of a
// Page Object Model's implementation, and the app's setup still runs.
it("ships neither the runtime nor the Page Object Models in a build without Ayme, and still runs the app's setup", async () => {
  const root = fileURLToPath(
    new URL("./__tests__/fixtures/withoutAyme/", import.meta.url)
  );
  const outDir = mkdtempSync(join(tmpdir(), "ayme-without-"));
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      root,
      plugins: [ayme({ report: "none" })],
      build: {
        outDir,
        lib: { entry: join(root, "main.ts"), formats: ["es"], fileName: "app" },
        rolldownOptions: { external: [/^@playwright\//] },
      },
    });
    const files = readdirSync(outDir).filter((file) => file.endsWith(".js"));
    const code = files
      .map((file) => readFileSync(join(outDir, file), "utf8"))
      .join("\n");

    // The runtime's own strings, the compiled manifest and the action's body.
    expect(code).not.toContain("Waiting for the WebMCP driver.");
    expect(code).not.toContain("registerCompiledPom");
    expect(code).not.toContain("Add an item to the list.");
    expect(code).not.toContain("getByLabel");
    expect(code).not.toContain("playwright");
    // The module only the Page Object Model imported.
    expect(code).not.toContain("Item name");
    expect(code.length).toBeLessThan(20_000);

    const app = (await import(
      pathToFileURL(join(outDir, "app.js")).href
    )) as typeof import("./__tests__/fixtures/withoutAyme/main");
    expect(app.ayme.tools.list()).toEqual([]);
    expect(app.ayme.webMCP.publicationStatus.state).toBe("disabled");
    await expect(app.page.addItem("Eggs")).rejects.toThrow(
      "Ayme was removed from this build. ListPage.addItem is not in it."
    );
    app.stop();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 30_000);

// Integration on the built packages: the source map of a build without Ayme
// carries the stand-in, not the Page Object Model it replaced. Rollup keeps
// a module's loaded code as the leaf of its source-map chain, so a stand-in
// made by a transform hook shipped the model in `sourcesContent` on Vite 7;
// the plugin now compiles the stand-in while loading. Rolldown (Vite 8), which
// runs here, did not leak through a transform either, so this is a regression
// guard rather than the reproduction.
it("maps a build without Ayme to the stand-in, not to the Page Object Model", async () => {
  const root = fileURLToPath(
    new URL("./__tests__/fixtures/withoutAyme/", import.meta.url)
  );
  const outDir = mkdtempSync(join(tmpdir(), "ayme-without-map-"));
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      root,
      plugins: [ayme({ report: "none" })],
      build: {
        outDir,
        sourcemap: "inline",
        lib: { entry: join(root, "main.ts"), formats: ["es"], fileName: "app" },
        rolldownOptions: { external: [/^@playwright\//] },
      },
    });
    const code = readFileSync(join(outDir, "app.js"), "utf8");
    const encoded = code.match(
      /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/
    )?.[1];
    if (!encoded) throw new Error("Expected an inline source map.");
    const map = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      sources: string[];
      sourcesContent?: (string | null)[];
    };

    const listPage = map.sources.findIndex((source) =>
      source.endsWith("ListPage.ts")
    );
    expect(listPage).toBeGreaterThanOrEqual(0);
    const contents = map.sourcesContent ?? [];
    expect(contents[listPage]).toContain("absentPageObject");
    for (const content of contents) {
      expect(content ?? "").not.toContain("getByLabel");
      expect(content ?? "").not.toContain("Add an item to the list.");
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 30_000);

// Integration on the built packages: a framework package leaves a build
// without Ayme with the runtime, so none of its hook code ships. React is the
// integration the plugin's tests can bundle with the fewest dependencies.
it("ships none of a framework package's hook code in a build without Ayme", async () => {
  const root = fileURLToPath(
    new URL("./__tests__/fixtures/withoutAymeReact/", import.meta.url)
  );
  const outDir = mkdtempSync(join(tmpdir(), "ayme-without-react-"));
  try {
    await build({
      configFile: false,
      logLevel: "silent",
      root,
      plugins: [ayme({ report: "none" })],
      build: {
        outDir,
        lib: { entry: join(root, "main.ts"), formats: ["es"], fileName: "app" },
        rolldownOptions: { external: ["react"] },
      },
    });
    const code = readFileSync(join(outDir, "app.js"), "utf8");

    // The absent entries are in; the index's errors and hooks are not.
    expect(code).toContain("Ayme was removed from this build.");
    expect(code).not.toContain("Ayme hooks require an ancestor AymeProvider.");
    expect(code).not.toContain(
      "AymeProvider cannot be nested beneath another Ayme runtime owner."
    );
    expect(code).not.toContain(
      "The provider options changed while the provider was mounted."
    );
    expect(code).not.toContain(
      "The Page Object model or provider changed while the component was mounted."
    );
    expect(code).not.toContain("useSyncExternalStore");
    expect(code).not.toContain("Waiting for the WebMCP driver.");
    expect(code.length).toBeLessThan(20_000);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 30_000);
