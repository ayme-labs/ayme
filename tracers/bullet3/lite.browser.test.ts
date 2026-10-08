// Bullet 3, Lite part: the first three checks plus unmount/dispose on Playwright Lite in the browser.
import { createPage } from "@ayme-dev/playwright-lite";
import { it } from "../../packages/ayme/node_modules/vitest/dist/index.js";

const out = (k: string, v: unknown) => console.log(`LITE ${k}: ${JSON.stringify(v)}`);
const tryIt = async (k: string, fn: () => Promise<unknown>) => {
  try { out(k, await fn()); } catch (e) { out(k + " THREW", (e as Error).message.split("\n").slice(0, 2).join(" | ")); }
};

it("element handles as root identity", async () => {
  document.body.innerHTML = `<section aria-label="Counter"><p>Count: <output>0</output></p><button>Increment</button></section>`;
  const page = createPage();
  const region = page.getByRole("region", { name: "Counter" });
  const h = await region.elementHandle();
  await tryIt("1 h === querySelector", () => page.evaluate((el) => el === document.querySelector('section[aria-label="Counter"]'), h));
  const h2 = await region.elementHandle();
  await tryIt("2 h === h2 in-page", () => page.evaluate(([a, b]) => a === b, [h, h2] as const));
  out("2 h === h2 object identity", h === h2);
  document.querySelector("output")!.textContent = "1"; // in-place update, as React does
  await tryIt("2b after in-place update h still same node", () => h.evaluate((el) => el === document.querySelector("section") && el.isConnected));
  document.querySelector("section")!.remove();
  await tryIt("3 after removal h.evaluate(isConnected)", () => h.evaluate((el) => el.isConnected));
  await tryIt("3 after removal h.textContent()", () => h.textContent());
  await tryIt("3 after removal h.isVisible()", () => h.isVisible());
  await tryIt("3 after removal h.click({timeout:500})", () => h.click({ timeout: 500 }).then(() => "clicked"));
  await h2.dispose();
  await tryIt("5 after dispose h2.evaluate", () => h2.evaluate((el) => el.isConnected));
  await tryIt("5 after dispose page.evaluate(el, h2)", () => page.evaluate((el) => !!el, h2));
  await tryIt("5 dispose twice", () => h2.dispose().then(() => "ok"));
});
