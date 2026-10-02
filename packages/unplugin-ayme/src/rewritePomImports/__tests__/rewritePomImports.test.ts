import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { rewritePomImports } from "..";

function rewrittenImport(importDeclaration: string) {
  const fileName = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures/rewrite-input.ts"
  );
  return rewritePomImports(
    `${importDeclaration}\nexport const value = 1;\n`,
    fileName
  );
}

describe("rewritePomImports", () => {
  it("bypasses an unused runtime playwright branch", () => {
    expect(
      rewrittenImport('import { safe } from "./playwright-barrel";')
    ).toContain('import { safe } from "./safe";');
    expect(
      rewrittenImport('import { safe } from "./playwright-barrel";')
    ).not.toContain("playwright-barrel");
  });

  it("bypasses an unused runtime @playwright/test branch", () => {
    expect(
      rewrittenImport('import { safe } from "./playwright-test-barrel";')
    ).toContain('import { safe } from "./safe";');
    expect(
      rewrittenImport('import { safe } from "./playwright-test-barrel";')
    ).not.toContain("playwright-test-barrel");
  });

  it("leaves type-only Playwright branches unchanged", () => {
    const source = rewrittenImport(
      'import { safe } from "./type-only-barrel";'
    );
    expect(source).toContain('from "./type-only-barrel"');
    expect(source).not.toContain('from "./safe"');
  });

  it("leaves a selected Playwright-dependent module unchanged", () => {
    const source = rewrittenImport(
      'import { tainted } from "./playwright-barrel";'
    );
    expect(source).toContain('from "./playwright-barrel"');
    expect(source).not.toContain('from "./playwright-runtime"');
  });

  it("does not taint unrelated exports from a barrel's direct Playwright import", () => {
    const source = rewrittenImport(
      'import { safe } from "./direct-playwright-barrel";'
    );
    expect(source).toContain('import { safe } from "./safe";');
    expect(source).not.toContain("direct-playwright-barrel");
  });

  it("leaves a selected direct Playwright export unchanged", () => {
    const source = rewrittenImport(
      'import { chromium } from "./direct-playwright-barrel";'
    );
    expect(source).toContain('from "./direct-playwright-barrel"');
  });

  it("leaves unrelated Node-only branches unchanged", () => {
    const source = rewrittenImport('import { safe } from "./node-barrel";');
    expect(source).toContain('from "./node-barrel"');
    expect(source).not.toContain('from "./safe"');
  });

  it("preserves aliases and splits selected modules", () => {
    const source = rewrittenImport(
      'import { safe as first, second } from "./playwright-barrel";'
    );
    expect(source).toContain('import { safe as first } from "./safe";');
    expect(source).toContain('import { second } from "./second";');
    expect(source).not.toContain("playwright-barrel");
  });

  it("preserves aliases introduced by a re-export", () => {
    const source = rewrittenImport(
      'import { sourceSafe as localSafe } from "./playwright-barrel";'
    );
    expect(source).toContain('import { safe as localSafe } from "./safe";');
    expect(source).not.toContain("playwright-barrel");
  });

  it("preserves type-only specifiers while splitting runtime imports", () => {
    const source = rewrittenImport(
      'import { safe as first, type TypeOnlyPage } from "./playwright-barrel";'
    );
    expect(source).toContain('import { safe as first } from "./safe";');
    expect(source).toContain(
      'import { type TypeOnlyPage } from "./playwright-type";'
    );
    expect(source).not.toContain("playwright-barrel");
  });
});
