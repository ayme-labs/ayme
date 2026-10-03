import { expect, test } from "@playwright/test";
import {
  executePublishedTool,
  publishedToolNames,
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/ayme/testing";
import fs from "node:fs";

const RUNTIME_TOOLS = ["snapshot", "click", "fill"];
const POM_TOOL = "CounterPage.increment";

for (const entry of ["index.html", "ssr.html"]) {
  test(`${entry}: register, act, unmount, remount`, async ({
    page,
    context,
    request,
  }) => {
    const messages: string[] = [];
    page.on("console", (m) => messages.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => messages.push(`pageerror: ${e.message}`));
    await recordPublishedTools(context);
    if (entry === "ssr.html") {
      const html = await (await request.get(`/${entry}`)).text();
      expect(html).toMatch(/<output>0<\/output>/);
      expect(html).toMatch(/Publication: /);
    }
    await page.goto(`/${entry}`);
    const status = page.getByRole("status", { name: "Publication" });
    await expect(status).toHaveText("Publication: active");
    await waitForPublishedTool(page, POM_TOOL);
    expect(await publishedToolNames(page)).toEqual([
      ...RUNTIME_TOOLS,
      POM_TOOL,
    ]);
    if (entry === "ssr.html")
      // Hydration adopted the server markup instead of replacing it.
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __ssrNode?: Element }).__ssrNode ===
            document.querySelector('section[aria-label="Counter"]')
        )
      ).toBe(true);
    await executePublishedTool(page, POM_TOOL);
    await expect(page.locator("output")).toHaveText("1");
    await page.getByRole("button", { name: "Call Page Object" }).click();
    await expect(page.locator("output")).toHaveText("2");
    await page.getByRole("button", { name: "Unmount counter" }).click();
    await expect.poll(() => publishedToolNames(page)).toEqual(RUNTIME_TOOLS);
    await page
      .getByRole("button", { name: "Mount counter", exact: true })
      .click();
    await expect
      .poll(() => publishedToolNames(page))
      .toEqual([...RUNTIME_TOOLS, POM_TOOL]);
    await expect(page.locator("output")).toHaveText("0");
    await executePublishedTool(page, POM_TOOL);
    await expect(page.locator("output")).toHaveText("1");
    fs.writeFileSync(`console-${entry}.log`, messages.join("\n") + "\n");
    expect(messages.filter((m) => /^(error|pageerror)/.test(m))).toEqual([]);
    expect(
      messages.filter((m) => /hydrat|mismatch|did not match/i.test(m))
    ).toEqual([]);
  });
}
