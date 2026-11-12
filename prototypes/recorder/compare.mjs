// Step 4: the same scripted flow in every mode, Change Trees side by side.
// usage: node compare.mjs [--flow fixture|saucedemo] [--pw 1.65] [--modes after,before,gate-a,gate-b] [--headed]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODES, writeRecording, describeEntry } from "./lib/recorder.mjs";
import { serveFixture } from "./lib/fixture.mjs";
import { createHuman } from "./lib/human.mjs";
import { flows, stepper } from "./lib/flows.mjs";
import { openRecording } from "./run.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const flowName = arg("flow", "fixture");
const version = arg("pw", "1.65");
const modes = arg("modes", MODES.join(",")).split(",");
const headed = process.argv.includes("--headed");
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const flow = flows[flowName];
if (!flow) throw new Error(`unknown flow ${flowName}`);

const fixture = await serveFixture();
const results = {};
let steps = [];
let real = version;
for (const mode of modes) {
  console.log(`== ${flowName} in mode ${mode} on Playwright ${version}`);
  const { browser, context, page, recording } = await openRecording({
    mode,
    version,
    url: flow.url(fixture.origin),
    headed,
    onlyHost: flow.onlyHost,
  });
  const human = await createHuman(context, page);
  const { step, steps: ran } = stepper(console.log);
  await flow.run({
    page,
    human,
    step: (name, fn, wait) => {
      recording.label = name;
      return step(name, fn, wait);
    },
  });
  const result = await recording.stop();
  real = result.meta.playwright;
  writeRecording(
    path.join(outDir, `${flowName}-${mode}-pw${real}.json`),
    result
  );
  results[mode] = result;
  steps = ran;
  await browser.close();
}
fixture.close();

// side by side, step by step
const lines = [`# ${flowName} on Playwright ${real}: Change Trees by mode`, ""];
lines.push("Settle rule: " + results[modes[0]].meta.settleRule, "");
for (const mode of modes) {
  const meta = results[mode].meta;
  if (meta.gateLagsMs)
    lines.push(
      `- ${mode}: gate cycles without a recorded action: ${meta.gateCyclesWithoutRecordedAction}; lags (ms): ${JSON.stringify(summarise(meta.gateLagsMs))}`
    );
}
lines.push("");
for (const name of steps) {
  lines.push(`## ${name}`, "");
  for (const mode of modes) {
    const entries = results[mode].entries.filter(
      (e) => e.label === name.split("  !!")[0]
    );
    lines.push(`### ${mode}`, "", "```");
    lines.push(
      entries.length
        ? entries.map(describeEntry).join("\n")
        : "(no interaction recorded)"
    );
    lines.push("```", "");
  }
}
const file = path.join(outDir, `compare-${flowName}-pw${real}.md`);
fs.writeFileSync(file, lines.join("\n"));
console.log("wrote", file);

function summarise(lags) {
  const by = {};
  for (const lag of lags) (by[lag.kind] ??= []).push(lag);
  const median = (xs) =>
    +[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(1);
  return Object.fromEntries(
    Object.entries(by).map(([kind, list]) => [
      kind,
      {
        n: list.length,
        medianMs: median(list.map((l) => l.click)),
        maxMs: +Math.max(...list.map((l) => l.click)).toFixed(1),
        pressMedianMs: median(list.map((l) => l.press)),
      },
    ])
  );
}
