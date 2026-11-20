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
        "src/timeline/domain/misplaced.ts",
        'export type { BrowserSignal } from "../../session/domain";\n'
      )
    ).toEqual([expect.stringContaining("timeline may only use")]);
  }
);

// ADR-0046: the layer order holds across slices, because a layered slice is
// reached through the front door of the layer that is used.
it(
  "lint keeps the layer order across slices, through one front door per layer",
  slow,
  async () => {
    // An application module may not act through another slice's
    // infrastructure, such as the disk.
    expect(
      await lint(
        "src/session/application/misplaced.ts",
        'export { saveRecording } from "../../timeline/infrastructure";\n'
      )
    ).toEqual([
      expect.stringContaining(
        "application may only depend on the allowed horizontal layers"
      ),
    ]);
    expect(
      await lint(
        "src/session/domain/misplaced.ts",
        'export { RecorderSession } from "../../session/application";\n'
      )
    ).toContainEqual(
      expect.stringContaining(
        "domain may only depend on the allowed horizontal layers"
      )
    );
    expect(
      await lint(
        "src/session/application/placed.ts",
        'export { Timeline } from "../../timeline/domain";\n'
      )
    ).toEqual([]);
    // A layered slice has no front door of its own to hide the layer behind.
    expect(
      await lint(
        "src/engine/misplaced.ts",
        'export { Timeline } from "../timeline";\n'
      )
    ).toEqual([expect.stringContaining("A layered slice has no index.ts")]);
    // Past a front door.
    expect(
      await lint(
        "src/engine/misplaced.ts",
        'export { step } from "../session/domain/lifecycle";\n'
      )
    ).toEqual([
      expect.stringContaining("Import another slice through its front door"),
    ]);
    expect(
      await lint(
        "src/session/application/misplaced.ts",
        'export { startRecorderOn } from "../../engine/recorder";\n'
      )
    ).toContainEqual(
      expect.stringContaining("Import another slice through its front door")
    );
    // The composition root uses the layers it puts together.
    expect(
      await lint(
        "src/engine/placed.ts",
        'export { saveRecording } from "../timeline/infrastructure";\nexport { RecorderSession } from "../session/application";\n'
      )
    ).toEqual([]);
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

// docs/testing.md#code-a-real-browser-runs: the folder decides how code is
// measured, so lint keeps each kind of code in its folder.
it(
  "lint keeps plain logic away from code that drives a browser or runs in the page",
  slow,
  async () => {
    const plainOnly = [
      expect.stringContaining("Plain logic stays testable without a browser"),
    ];
    for (const path of [
      "src/playwright/infrastructure/misplaced.ts",
      "src/playwright/infrastructure/misplaced.test.ts",
    ]) {
      expect(
        await lint(
          path,
          'export { stockBrowser } from "./live/stockBrowser";\n'
        ),
        path
      ).toEqual(plainOnly);
      expect(
        await lint(path, 'export { setGate } from "./in-page/calls";\n'),
        path
      ).toEqual(plainOnly);
    }
    // The layer's front door wires the stock adapter, and nothing in the
    // page.
    expect(
      await lint(
        "src/playwright/infrastructure/index.ts",
        'export { stockBrowser } from "./live/stockBrowser";\n'
      )
    ).toEqual([]);
    expect(
      await lint(
        "src/playwright/infrastructure/index.ts",
        'export { setGate } from "./in-page/calls";\n'
      )
    ).toEqual([
      expect.stringContaining("reached from infrastructure/live only"),
    ]);
    // Outside the slice, the adapter is reached through the front door.
    expect(
      await lint(
        "src/engine/misplaced.ts",
        'export { stockBrowser } from "../playwright/infrastructure/live/stockBrowser";\n'
      )
    ).toContainEqual(expect.stringContaining("front door"));
    // live/ uses both.
    expect(
      await lint(
        "src/playwright/infrastructure/live/placed.ts",
        'export { setGate } from "../in-page/calls";\nexport { withRules } from "../pageRules";\n'
      )
    ).toEqual([]);
  }
);

it(
  "lint lets code that runs in the page import types only, and keeps it trivial",
  slow,
  async () => {
    const path = "src/playwright/infrastructure/in-page/misplaced.ts";
    expect(
      await lint(
        path,
        'import { mouseRoute } from "../pageRules";\nexport const route = mouseRoute;\n'
      )
    ).toEqual([expect.stringContaining("may import types only")]);
    expect(
      await lint(
        path,
        'import type { MouseRoute } from "../pageRules";\nexport type Route = MouseRoute;\n'
      )
    ).toEqual([]);
    // A decision of five ways belongs in a plain rule; four still fit.
    const decide = (ways: number) =>
      `export function decide(n: number): number {\n${Array.from(
        { length: ways - 1 },
        (_, i) => `  if (n === ${i}) return ${i};\n`
      ).join("")}  return -1;\n}\n`;
    expect(await lint(path, decide(5))).toEqual([
      expect.stringContaining("complexity of 5. Maximum allowed is 4"),
    ]);
    expect(await lint(path, decide(4))).toEqual([]);
  }
);
