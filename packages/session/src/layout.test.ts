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

it("lint keeps each slice to the slices it may use", slow, async () => {
  expect(
    await lint(
      "src/session/application/misplaced.ts",
      'export { stockBrowser } from "../../playwright/infrastructure";\n'
    )
  ).toContainEqual(expect.stringContaining("session may only use itself"));
  expect(
    await lint(
      "src/playwright/infrastructure/misplaced.ts",
      'export { askSession } from "../../process/infrastructure";\n'
    )
  ).toContainEqual(
    expect.stringContaining(
      "playwright may only use session, page-objects, itself"
    )
  );
  expect(
    await lint(
      "src/page-objects/infrastructure/misplaced.ts",
      'export { stockBrowser } from "../../playwright/infrastructure";\n'
    )
  ).toContainEqual(
    expect.stringContaining("page-objects may only use session, itself")
  );
  expect(
    await lint(
      "src/process/infrastructure/placed.ts",
      'export { stockBrowser } from "../../playwright/infrastructure";\n'
    )
  ).toEqual([]);
});

it("lint keeps the layer order inside a slice", slow, async () => {
  expect(
    await lint(
      "src/session/domain/misplaced.ts",
      'export { openSession } from "../application";\n'
    )
  ).toContainEqual(
    expect.stringContaining(
      "domain may only depend on the allowed horizontal layers"
    )
  );
});

it(
  "lint keeps Playwright and the browser package in the playwright slice, and Playwright to its types",
  slow,
  async () => {
    expect(
      await lint(
        "src/process/infrastructure/misplaced.ts",
        'export { browser } from "@ayme-dev/browser";\n'
      )
    ).toEqual([expect.stringContaining("Only the playwright slice")]);
    expect(
      await lint(
        "src/playwright/infrastructure/misplaced.ts",
        'import { chromium } from "playwright-core";\nexport { chromium };\n'
      )
    ).toEqual([expect.stringContaining("imports Playwright's types only")]);
    expect(
      await lint(
        "src/playwright/infrastructure/placed.ts",
        'import type { Browser } from "playwright-core";\nexport type B = Browser;\n'
      )
    ).toEqual([]);
  }
);

it(
  "lint keeps Effect out of the front door and the domain layers",
  slow,
  async () => {
    for (const path of ["src/index.ts", "src/session/domain/misplaced.ts"])
      expect(
        await lint(
          path,
          'import { Effect } from "effect";\nexport { Effect };\n'
        ),
        path
      ).toEqual([expect.stringContaining("No Effect here")]);
    expect(
      await lint(
        "src/process/infrastructure/misplaced.ts",
        'import * as M from "effect/unstable/http";\nexport { M };\n'
      )
    ).toEqual([expect.stringContaining("only the stable effect package")]);
  }
);

it(
  "lint lets only the layer's front door reach the code that drives a real browser",
  slow,
  async () => {
    expect(
      await lint(
        "src/playwright/infrastructure/misplaced.ts",
        'export { stockBrowser } from "./live/stockBrowser";\n'
      )
    ).toEqual([expect.stringContaining("reaches infrastructure/live")]);
    expect(
      await lint(
        "src/playwright/infrastructure/index.ts",
        'export { stockBrowser } from "./live/stockBrowser";\n'
      )
    ).toEqual([]);
    expect(
      await lint(
        "src/page-objects/infrastructure/misplaced.ts",
        'export { projectPageObjects } from "./live/nodeBuild";\n'
      )
    ).toEqual([expect.stringContaining("reaches infrastructure/live")]);
    expect(
      await lint(
        "src/page-objects/infrastructure/index.ts",
        'export { projectPageObjects } from "./live/nodeBuild";\n'
      )
    ).toEqual([]);
  }
);
