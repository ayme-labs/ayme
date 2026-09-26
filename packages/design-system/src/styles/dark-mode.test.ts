// @vitest-environment jsdom
import { join } from "node:path";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const entry = join(import.meta.dirname, "dark-mode.test.css");

describe("dark mode", () => {
  let darkSelector: string;

  beforeAll(async () => {
    const { css } = await postcss([tailwind()]).process(
      '@import "tailwindcss" source(none);\n@import "./tokens.css";\n@source inline("dark:hidden");\n',
      { from: entry }
    );
    darkSelector =
      css.match(/([^{}]*\.dark\\:hidden[^{]*)\{/)?.[1].trim() ?? "";
  }, 30_000);

  it("applies dark: styles to the element carrying .dark and everything inside it", () => {
    document.body.innerHTML = `
      <div id="dark-root" class="dark dark:hidden"><p id="dark-child" class="dark:hidden"></p></div>
      <div id="light-root" class="dark:hidden"><p id="light-child" class="dark:hidden"></p></div>`;
    const isDark = (id: string) =>
      document.getElementById(id)?.matches(darkSelector);

    expect(isDark("dark-root")).toBe(true);
    expect(isDark("dark-child")).toBe(true);
    expect(isDark("light-root")).toBe(false);
    expect(isDark("light-child")).toBe(false);
  });
});
