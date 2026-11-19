// Diagnostic only. Uses the workspace's real compiler, runtime, MCP and Radix.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createServer } from "../../apps/mcp-fixture/node_modules/vite/dist/node/index.js";
import { chromium } from "../../apps/mcp-fixture/node_modules/playwright/index.mjs";
import { ayme } from "../../packages/unplugin-ayme/dist/vite.mjs";
import {
  connectPage,
  freePort,
  ignoreAutoPairScan,
  startAgent,
} from "../../packages/mcp/dist/testing.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../..", import.meta.url));
const resolve = createRequire(
  new URL("./vendor/package.json", import.meta.url)
).resolve;
const rows = Number(process.env.ROWS ?? 7);
const gap = Number(process.env.GAP ?? 8);
const oldAvailability = process.env.OLD_AVAILABILITY === "1";
let oldAvailabilityApplied = 0;
const width = Number(process.env.WIDTH ?? 1280);
const rowWidth = Number(process.env.ROW_WIDTH ?? 480);
const modes = (process.env.MODES ?? "hover,click").split(",");
const overflow = process.env.OVERFLOW ?? "auto";
const prime = process.env.PRIME ?? "none";
const repetitions = Number(process.env.REPETITIONS ?? 1);
const drivers = (process.env.DRIVERS ?? "host,lite,ayme").split(",");
const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  cacheDir: `${root}/node_modules/.vite`,
  plugins: [
    // Replays only #987's guard before the fix. Never edits a production file.
    ...(oldAvailability
      ? [
          {
            name: "issue-959-replay-old-availability",
            enforce: "pre",
            transform(code, id) {
              const guard =
                "if (observed.present && observed.root?.available !== false)";
              if (
                id.includes("/packages/ayme/dist/runtime-") &&
                code.includes(guard)
              ) {
                oldAvailabilityApplied++;
                return code.replace(guard, "if (observed.present)");
              }
            },
          },
        ]
      : []),
    ayme({ include: true, playwright: { use: { actionTimeout: 1000 } } }),
  ],
  resolve: {
    alias: [
      { find: /^react$/, replacement: resolve("react") },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: resolve("react/jsx-dev-runtime"),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: resolve("react/jsx-runtime"),
      },
      { find: /^react-dom\/client$/, replacement: resolve("react-dom/client") },
      {
        find: /^@radix-ui\/react-dropdown-menu$/,
        replacement: resolve("@radix-ui/react-dropdown-menu"),
      },
      {
        find: /^@ayme-dev\/ayme$/,
        replacement: `${repo}/packages/ayme/dist/index.mjs`,
      },
      {
        find: /^@ayme-dev\/ayme\/internal$/,
        replacement: `${repo}/packages/ayme/dist/internal.mjs`,
      },
    ],
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "@radix-ui/react-dropdown-menu"],
    exclude: ["@ayme-dev/ayme"],
    force: true,
  },
  server: {
    host: "127.0.0.1",
    port: await freePort(),
    strictPort: true,
    hmr: false,
    fs: { allow: [repo] },
  },
});
const results = [];
let browser, agent;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  agent = await startAgent("--port", String(await freePort()));
  const context = await browser.newContext({
    viewport: { width, height: 800 },
  });
  await ignoreAutoPairScan(context);
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    console.error("fixture page error:", error.message)
  );
  const base = server.resolvedUrls.local[0];
  for (let iteration = 0; iteration < repetitions; iteration++) {
    for (const mode of modes) {
      for (const driver of drivers) {
        await connectPage(
          agent,
          page,
          `${base}?rows=${rows}&gap=${gap}&rowWidth=${rowWidth}&overflow=${overflow}&prime=${prime}&case=${iteration}-${mode}-${driver}`
        );
        await page.waitForFunction(() =>
          window.diagnostic?.runtime.tools
            .list()
            .some((t) => t.name === "SurveyList.setCompleted")
        );
        assert.equal(
          await page.locator("output").textContent(),
          "inProgress",
          "Each case must start unselected"
        );
        // Reset the host pointer to an ordinary neutral point before each run.
        await page.mouse.move(10, 10);
        const openStart = performance.now();
        if (driver === "ayme") {
          const snapshot = await agent.call("snapshot");
          const structure = JSON.parse(snapshot.text).structure;
          const ref = structure.match(/(e\d+|s_\w+) SurveyRow\b/)?.[1];
          assert.ok(ref, `No SurveyRow root in ${structure}`);
          const opened = await agent.call("SurveyRow.openOptions", {
            ref,
            args: {},
          });
          assert.equal(opened.isError, false, opened.text);
        } else {
          await page.getByTestId("survey-dropdown-trigger").first().click();
        }
        const openMs = performance.now() - openStart;
        await page.getByTestId("change-status").waitFor();
        const openEvents = await page.evaluate(() =>
          window.diagnostic.events.slice()
        );
        await page.evaluate(() => {
          window.diagnostic.events.length = 0;
        });
        const start = performance.now();
        let error;
        try {
          if (driver === "ayme") {
            const answer = await agent.call("SurveyList.setCompleted", {
              mode,
            });
            if (answer.isError) throw new Error(answer.text);
          } else if (driver === "lite") {
            await page.evaluate((mode) => window.diagnostic.direct(mode), mode);
          } else {
            const trigger = page.getByRole("menuitem", {
              name: "Change status",
              exact: true,
            });
            if (mode === "hover") await trigger.hover({ timeout: 3000 });
            else await trigger.click({ timeout: 3000 });
            if (prime === "left") {
              const box = await trigger.boundingBox();
              assert.ok(box);
              await page.mouse.move(
                box.x + box.width - 4,
                box.y + box.height / 2
              );
              await page.mouse.move(
                box.x + box.width / 2,
                box.y + box.height / 2
              );
            }
            await page
              .getByTestId("survey-status-option-completed")
              .click({ timeout: 3000 });
          }
        } catch (failure) {
          error = failure.message.replace(/\u001b\[[0-9;]*m/g, "");
        }
        const ms = performance.now() - start;
        const evidence = await page.evaluate(() => ({
          events: window.diagnostic.events,
          state: window.diagnostic.state(),
        }));
        const result = {
          driver,
          mode,
          iteration,
          rows,
          gap,
          width,
          rowWidth,
          overflow,
          prime,
          oldAvailability,
          openMs,
          ms,
          error,
          openEvents,
          ...evidence,
        };
        results.push(result);
        console.log(
          JSON.stringify({
            driver,
            mode,
            iteration,
            rows,
            gap,
            openMs: Math.round(openMs),
            ms: Math.round(ms),
            status: evidence.state.status,
            error: error?.split("\n")[0],
          })
        );
      }
    }
  }
  await mkdir(`${root}/evidence`, { recursive: true });
  await writeFile(
    `${root}/evidence/${process.env.EVIDENCE ?? "latest"}.json`,
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: repo,
          encoding: "utf8",
        }).trim(),
        browser: browser.version(),
        radix: "2.1.16",
        react: "19.2.6",
        oldAvailabilityApplied,
        results,
      },
      null,
      2
    ) + "\n"
  );
  if (oldAvailability)
    assert.ok(
      oldAvailabilityApplied > 0,
      "Old availability guard replay must be applied"
    );
  const failures = results.filter(
    (result) =>
      result.error ||
      result.state.status !== "completed" ||
      !result.events.some(
        (event) => event.kind === "selected" && event.value === "completed"
      )
  );
  assert.equal(
    failures.length,
    0,
    `${failures.length}/${results.length} submenu selections failed; see the saved event evidence`
  );
  console.log(`PASS ${results.length} real Radix submenu selections`);
} finally {
  await agent?.close();
  await browser?.close();
  await server.close();
}
