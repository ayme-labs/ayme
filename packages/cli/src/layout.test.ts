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

// ESLint loads the package config on first use.
it(
  "lint keeps Playwright and Effect out of the CLI",
  { timeout: 60_000 },
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
      ).toEqual([
        expect.stringContaining("The CLI brings no Playwright of its own"),
      ]);
    expect(
      await lint(
        "src/misplaced.ts",
        'export const playwright = await import("playwright");\n'
      )
    ).toEqual([
      expect.stringContaining("The CLI brings no Playwright of its own"),
    ]);
    expect(
      await lint(
        "src/misplaced.ts",
        'import { Effect } from "effect";\nexport { Effect };\n'
      )
    ).toEqual([expect.stringContaining("No Effect in the CLI")]);
  }
);
