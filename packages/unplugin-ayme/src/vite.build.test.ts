import { fileURLToPath } from "node:url";

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
  const plugin = ayme({ report: "none" });
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
