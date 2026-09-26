import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { compileShadowCss } from "./vite-plugin";

const themeCss = fileURLToPath(new URL("../styles/theme.css", import.meta.url));

describe("compileShadowCss", () => {
  let css: string;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "design-system-shadow-"));
    writeFileSync(
      join(dir, "panel.html"),
      '<div class="bg-primary p-4 shadow-sm dark:bg-card"></div>'
    );
    const entry = join(dir, "panel.css");
    writeFileSync(
      entry,
      `@import "tailwindcss" source(none);\n@import "${themeCss}";\n@source "./panel.html";\n`
    );
    css = await compileShadowCss(entry);
  }, 30_000);

  it("declares the light tokens on :host as well as :root", () => {
    expect(css).toMatch(/:root,\s*:host\s*\{[^}]*--background:/);
  });

  it("applies Tailwind's --tw-* initials inside a shadow root", () => {
    const properties = css.match(/@layer properties\{.*?\}\}/s)?.[0];
    expect(properties).toMatch(/^@layer properties\{:host,\s*\*/);
    expect(properties).not.toContain("@supports");
    expect(properties).toContain("--tw-shadow:0 0 #0000");
  });

  it("writes lengths in px, independent of the host page's font size", () => {
    expect(css).not.toMatch(/\d+(\.\d+)?rem\b/);
  });

  it("compiles the design system's components and the dark variant", () => {
    expect(css).toContain(".bg-primary");
    expect(css).toMatch(/\.dark/);
  });
});
