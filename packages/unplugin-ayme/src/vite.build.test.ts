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
