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

it(
  "lint flags an import against the slice and layer layout",
  slow,
  async () => {
    expect(
      await lint(
        "src/session/domain/misplaced.ts",
        'export { runSession } from "../application/recorderSession";\n'
      )
    ).toEqual([
      expect.stringContaining(
        "domain may only depend on the allowed horizontal layers"
      ),
    ]);
    expect(
      await lint(
        "src/session/application/misplaced.ts",
        'export { stockBrowser } from "../../playwright";\n'
      )
    ).toEqual([expect.stringContaining("session may only use")]);
    expect(
      await lint(
        "src/engine/misplaced.ts",
        'export { step } from "../session/domain/lifecycle";\n'
      )
    ).toEqual([
      expect.stringContaining("Import another slice through its index.ts."),
    ]);
  }
);

it("lint lets only the playwright slice import Playwright", slow, async () => {
  const onlyPlaywrightSlice = [
    expect.stringContaining("Only the playwright slice imports Playwright"),
  ];
  for (const specifier of ["playwright", "playwright-core", "@playwright/test"])
    expect(
      await lint(
        "src/engine/misplaced.ts",
        `import type { Browser } from "${specifier}";\nexport type Misplaced = Browser;\n`
      ),
      specifier
    ).toEqual(onlyPlaywrightSlice);
  expect(
    await lint(
      "src/session/application/misplaced.ts",
      'export const playwright = await import("playwright-core");\n'
    )
  ).toEqual(onlyPlaywrightSlice);
  expect(
    await lint(
      "src/session/application/misplaced.test.ts",
      'import { chromium } from "playwright-core";\nexport { chromium };\n'
    )
  ).toEqual(onlyPlaywrightSlice);
  expect(
    await lint(
      "src/playwright/infrastructure/placed.ts",
      'import type { Browser } from "playwright-core";\nexport type Placed = Browser;\n'
    )
  ).toEqual([]);
});

it(
  "lint keeps Effect out of the pure rules, the contract and the front door",
  slow,
  async () => {
    const effectFree = [expect.stringContaining("No Effect here")];
    for (const path of [
      "src/contract/misplaced.ts",
      "src/timeline/domain/misplaced.ts",
      "src/session/domain/misplaced.ts",
      "src/index.ts",
    ])
      expect(
        await lint(
          path,
          'import { Effect } from "effect";\nexport { Effect };\n'
        ),
        path
      ).toEqual(effectFree);
    expect(
      await lint(
        "src/session/application/placed.ts",
        'import { Effect } from "effect";\nexport { Effect };\n'
      )
    ).toEqual([]);
  }
);

it(
  "lint lets production code use only the stable effect package",
  slow,
  async () => {
    const stableOnly = [
      expect.stringContaining("only the stable effect package"),
    ];
    for (const specifier of ["effect/unstable/http", "@effect/platform-node"])
      expect(
        await lint(
          "src/session/application/misplaced.ts",
          `import * as other from "${specifier}";\nexport { other };\n`
        ),
        specifier
      ).toEqual(stableOnly);
    expect(
      await lint(
        "src/session/application/placed.test.ts",
        'import { it } from "@effect/vitest";\nexport { it };\n'
      )
    ).toEqual([]);
  }
);
