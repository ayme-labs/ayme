import { classes, manifests } from "./poms.ts";
import { livePageObjectTools, livePageObjectToolsSequential, type Registration } from "./probe.ts";
import { ORIGIN, serve } from "./serve.ts";

const ROOT = "/tmp/claude-0/-home-claude/9aad7f33-7b4d-5a05-916f-be31ec76afec/scratchpad/liveness";
const PW = process.env.PW_PATH ?? `${ROOT}/ayme/apps/example-react/node_modules/playwright/index.mjs`;
const { chromium } = await import(PW);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await serve(page, { pilot: `${ROOT}/pilot` });
await page.goto(`${ORIGIN}/pilot/fixture.html`);

const registrations: Registration[] = Object.entries(classes).map(([name, C]) => ({ manifest: manifests[name]!, instance: new C(page) }));
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const ms = (x: number) => x.toFixed(1).padStart(6);

async function check(label: string, regs = registrations, repeats = 7) {
  const batched = []; const sequential = [];
  let answer!: Awaited<ReturnType<typeof livePageObjectTools>>;
  for (let i = 0; i < repeats; i++) { answer = await livePageObjectTools(page, regs); batched.push(answer.timings); }
  for (let i = 0; i < repeats; i++) sequential.push((await livePageObjectToolsSequential(page, regs)).totalMs);
  console.log(`\n== ${label} (${regs.length} page objects) ==`);
  for (const p of answer.poms) {
    const gate = p.gate === "root" ? `root matches=${p.matches} present=${p.present} available=${p.available}` : "no root: live while registered";
    console.log(`  ${p.className.padEnd(14)} ${gate.padEnd(52)} live: ${p.liveTools.join(", ") || "-"}`);
  }
  console.log(`  batched  median ms: resolve ${ms(median(batched.map(t => t.resolveMs)))} + evaluate ${ms(median(batched.map(t => t.evaluateMs)))} (in page ${ms(median(batched.map(t => t.inPageMs)))}) = total ${ms(median(batched.map(t => t.totalMs)))}`);
  console.log(`  sequential (count+isVisible+evaluate per root) median ms: ${ms(median(sequential))}`);
  return answer;
}

await check("initial");
await page.getByRole("button", { name: "Unmount counter" }).click();
await check("counter unmounted");
await page.getByRole("button", { name: "Mount counter" }).click();
await page.getByRole("button", { name: "Archive" }).click();
await check("modal dialog open");
await page.keyboard.press("Escape");
await check("modal closed");
await page.getByRole("button", { name: "Open sidebar" }).click();
await check("sidebar open (covers the left 240px)");
// Scaling: the same five classes registered four times over, 20 roots in one evaluation.
const many: Registration[] = Array.from({ length: 4 }, (_, k) => registrations.map(r => ({ manifest: { ...r.manifest, className: `${r.manifest.className}${k}` }, instance: r.instance }))).flat();
await check("scaling: 20 registrations", many, 5);
await browser.close();
