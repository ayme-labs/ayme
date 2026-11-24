import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: packageRoot });

/** The lint messages for `code` as if it were the file at `path`. */
async function lint(path: string, code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: join(packageRoot, path),
  });
  return result!.messages.map(({ message }) => message);
}

// ESLint loads the package config and its import resolver on first use.
const slow = { timeout: 60_000 };

it("lint flags an import against the slice layout", slow, async () => {
  expect(
    await lint(
      "src/timeline/view/misplaced.ts",
      'export * from "../../controls";\n'
    )
  ).toEqual([expect.stringContaining("timeline may only use itself")]);
});

it(
  "lint lets the window know the engine only through its contract",
  slow,
  async () => {
    for (const specifier of [
      "@ayme-dev/recorder",
      "@ayme-dev/recorder/testing",
    ])
      expect(
        await lint(
          "src/app/misplaced.test.ts",
          `import type * as engine from "${specifier}";\nexport type Misplaced = typeof engine;\n`
        ),
        specifier
      ).toEqual([
        expect.stringContaining(
          "The window knows the engine only through @ayme-dev/recorder/contract"
        ),
      ]);
    expect(
      await lint(
        "src/app/placed.ts",
        'import type { RecorderUpdate } from "@ayme-dev/recorder/contract";\nexport type Placed = RecorderUpdate;\n'
      )
    ).toEqual([]);
  }
);

it(
  "lint lets a test, and no production code, use the page objects",
  slow,
  async () => {
    const code =
      'import { RecorderWindow } from "../testing";\nexport const Used = RecorderWindow;\n';
    expect(await lint("src/app/placed.browser.test.tsx", code)).toEqual([]);
    expect(await lint("src/app/misplaced.tsx", code)).toEqual([
      expect.stringContaining("Only test files may import a testing entry"),
      expect.stringContaining(
        "app may only use controls, timeline, channel, itself."
      ),
    ]);
  }
);

it(
  "lint lets the page objects, and only them, take Playwright's types",
  slow,
  async () => {
    expect(
      await lint(
        "src/testing/pom/Placed.ts",
        'import type { Page } from "@playwright/test";\nexport type Placed = Page;\n'
      )
    ).toEqual([]);
  }
);

it("lint keeps Playwright and Effect out of the window", slow, async () => {
  expect(
    await lint(
      "src/app/misplaced.ts",
      'import type { Page } from "playwright-core";\nexport type Misplaced = Page;\n'
    )
  ).toEqual([
    expect.stringContaining("Only the engine's playwright slice imports"),
  ]);
  expect(
    await lint(
      "src/app/misplaced.ts",
      'import { Effect } from "effect";\nexport { Effect };\n'
    )
  ).toEqual([expect.stringContaining("No Effect in the window")]);
});
