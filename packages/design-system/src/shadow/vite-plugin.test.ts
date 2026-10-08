import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { compileShadowCss } from "./vite-plugin";

const themeCss = fileURLToPath(new URL("../styles/theme.css", import.meta.url));

/** Compiles a panel whose markup is `html`, with or without the theme. */
async function compilePanel(html: string, { theme = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "design-system-shadow-"));
  writeFileSync(join(dir, "panel.html"), html);
  const entry = join(dir, "panel.css");
  writeFileSync(
    entry,
    `@import "tailwindcss" source(none);\n${theme ? `@import "${themeCss}";\n` : ""}@source "./panel.html";\n`
  );
  return compileShadowCss(entry);
}

describe("compileShadowCss", () => {
  let css: string;

  beforeAll(async () => {
    css = await compilePanel(
      '<div class="bg-primary/50 p-4 shadow-sm dark:bg-card text-2xl"></div>'
    );
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

  it("leaves the other layers' @supports guards and * rules alone", () => {
    expect(css).toMatch(/@supports \(color:color-mix\(/);
    expect(css).toMatch(/@layer base\{\*,/);
  });

  it("fails when the fallback lacks the --tw-shadow initials", async () => {
    await expect(
      compilePanel('<div class="translate-x-1"></div>', { theme: false })
    ).rejects.toThrow(/no longer emits the @layer properties fallback/);
  }, 30_000);

  it("names the entry stylesheet when it fails to compile", async () => {
    const entry = join(
      mkdtempSync(join(tmpdir(), "design-system-shadow-")),
      "panel.css"
    );
    writeFileSync(entry, '@import "./missing.css";\n');
    await expect(compileShadowCss(entry)).rejects.toThrow(entry);
  });

  it("writes lengths in px, independent of the host page's font size", () => {
    expect(css).not.toMatch(/\d+(\.\d+)?rem\b/);
    // Tailwind writes the spacing unit as .25rem, with no leading zero.
    expect(css).toContain("--spacing:4px");
    expect(css).toContain("--text-2xl:24px");
  });

  it("compiles the design system's components and the dark variant", () => {
    expect(css).toContain(".bg-primary");
    expect(css).toMatch(/\.dark/);
  });
});

describe("shadowTailwind", () => {
  it("loads with Node's own TypeScript support, as a build config does", () => {
    const plugin = new URL("./vite-plugin.ts", import.meta.url).href;
    const script = `const { shadowTailwind } = await import(${JSON.stringify(plugin)});
if (typeof shadowTailwind !== "function") process.exit(1);`;
    expect(() =>
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        stdio: "pipe",
      })
    ).not.toThrow();
  });
});
