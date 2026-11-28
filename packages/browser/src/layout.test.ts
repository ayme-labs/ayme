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

const ownPlaywright = expect.stringContaining(
  "loads the project's own Playwright"
);

// ESLint loads the package config on first use.
const slow = { timeout: 60_000 };

it(
  "lint keeps the package's own Playwright out of its code, but for its types",
  slow,
  async () => {
    for (const specifier of [
      "playwright",
      "playwright-core",
      "@playwright/test",
    ])
      expect(
        await lint(
          "src/misplaced.ts",
          `import { chromium } from "${specifier}";\nexport { chromium };\n`
        ),
        specifier
      ).toEqual([ownPlaywright]);
    expect(
      await lint(
        "src/misplaced.ts",
        'export const playwright = await import("playwright-core");\n'
      )
    ).toEqual([ownPlaywright]);
    expect(
      await lint(
        "src/misplaced.ts",
        'import type { Browser } from "playwright-core";\nexport type B = Browser;\n'
      )
    ).toEqual([]);
  }
);

it(
  "lint asks for a quoted module in import(), which it can check",
  slow,
  async () => {
    for (const specifier of ["playwright-core", "effect/unstable/http"])
      expect(
        await lint(
          "src/misplaced.ts",
          `export const module = await import(\`${specifier}\`);\n`
        ),
        specifier
      ).toEqual([
        expect.stringContaining(
          "Write the module in import() as a quoted string"
        ),
      ]);
  }
);

it("lint lets a test drive a browser of its own", slow, async () => {
  expect(
    await lint(
      "src/misplaced.test.ts",
      'import { chromium } from "playwright-core";\nexport { chromium };\n'
    )
  ).toEqual([]);
});

it(
  "lint keeps production code on the stable effect package",
  slow,
  async () => {
    for (const specifier of ["@effect/platform", "effect/unstable/http"])
      expect(
        await lint(
          "src/misplaced.ts",
          `import * as M from "${specifier}";\nexport { M };\n`
        ),
        specifier
      ).toEqual([expect.stringContaining("only the stable effect package")]);
  }
);

it(
  "lint keeps plain logic out of infrastructure/live, which only the front door reaches",
  slow,
  async () => {
    const reachesLive = [
      expect.stringContaining(
        "Only the front door reaches infrastructure/live"
      ),
    ];
    expect(
      await lint(
        "src/misplaced.ts",
        'export { browser } from "./infrastructure/live/browser";\n'
      )
    ).toEqual(reachesLive);
    expect(
      await lint(
        "src/infrastructure/misplaced.ts",
        'export type B = typeof import("./live/browser").browser;\n'
      )
    ).toEqual(reachesLive);
    expect(
      await lint(
        "src/index.ts",
        'export { browser } from "./infrastructure/live/browser";\n'
      )
    ).toEqual([]);
    expect(
      await lint(
        "src/infrastructure/live/placed.ts",
        'export { browser } from "./browser";\n'
      )
    ).toEqual([]);
  }
);
