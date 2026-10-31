// Standalone diagnostic, intentionally outside the regular test suite.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { format, stripVTControlCharacters } from "node:util";
import { chromium } from "playwright";
import { recordPublishedTools } from "../../../webmcp/src/testing.ts";

const require = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(require.resolve("vite"));
const matrix = process.argv.includes("--matrix");
const probe = process.argv.includes("--probe");
let protocol = [];
if (probe) {
  // Keep only protocol method names, IDs, timestamps and mouse event types.
  // Never retain evaluation scripts, browser state, or protocol result payloads.
  const pwRequire = createRequire(
    import.meta.resolve("playwright/package.json")
  );
  const { debug } = await import(
    join(
      dirname(pwRequire.resolve("playwright-core/package.json")),
      "lib/utilsBundle.js"
    )
  );
  const pending = new Map();
  debug.log = (...args) => {
    const line = stripVTControlCharacters(format(...args));
    const start = line.indexOf("{");
    if (start < 0) return;
    let message;
    try {
      message = JSON.parse(line.slice(start));
    } catch {
      return;
    }
    const key = `${message.sessionId}:${message.id}`;
    if (line.includes("SEND")) {
      const { method, params } = message;
      if (
        method !== "Input.dispatchMouseEvent" &&
        method !== "Runtime.callFunctionOn"
      )
        return;
      const summary = {
        id: message.id,
        method,
        type: params?.type,
        purpose:
          method === "Runtime.callFunctionOn"
            ? params.functionDeclaration?.includes("h.stop()")
              ? "stop-interceptor"
              : "other-evaluation"
            : undefined,
      };
      pending.set(key, summary);
      protocol.push({ atEpochMs: Date.now(), phase: "send", ...summary });
    } else if (line.includes("RECV") && pending.has(key)) {
      protocol.push({
        atEpochMs: Date.now(),
        phase: "receive",
        ...pending.get(key),
      });
      pending.delete(key);
    }
  };
  debug.enable("pw:protocol");
}
const cases = probe
  ? [{ path: "host", workMs: 1400 }]
  : matrix
    ? ["browser", "pom", "lite", "host"]
        .flatMap((path) => [0, 1400].map((workMs) => ({ path, workMs })))
        .concat(
          ["microtask", "timer"].flatMap((scheduling) =>
            ["lite", "host"].map((path) => ({ path, workMs: 1400, scheduling }))
          )
        )
        .concat([{ path: "host", workMs: 1400, timeoutMs: 0 }])
    : [0, 1400].map((workMs) => ({ path: "browser", workMs }));
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  configFile: false,
  server: { host: "127.0.0.1", port: 19570, strictPort: true },
});
await server.listen();
let browser;
const rows = [];
try {
  browser = await chromium.launch({ headless: true });
  const metadata = {
    browserVersion: browser.version(),
    nodeVersion: process.version,
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    mode: probe ? "probe" : matrix ? "matrix" : "red-capable",
  };
  console.log(JSON.stringify(metadata));
  for (const options of cases) {
    const context = await browser.newContext();
    await recordPublishedTools(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(error.message));
    await page.goto("http://127.0.0.1:19570/diagnostics/issue-957/");
    await page.waitForFunction(() => typeof window.diagnose957 === "function");
    let row;
    if (options.path === "host") {
      await page.evaluate((options) => window.configure957(options), options);
      protocol = [];
      const started = performance.now();
      const nodeStartedEpochMs = Date.now();
      let error;
      try {
        await page
          .locator("#apply")
          .click({ timeout: options.timeoutMs ?? 1000 });
      } catch (caught) {
        error = caught.message;
      }
      const returnedMs = performance.now() - started;
      const nodeReturnedEpochMs = Date.now();
      await page.evaluate(() => window.afterWork957());
      row = {
        ...options,
        ...(await page.evaluate(() => window.read957())),
        returnedMs,
        nodeStartedEpochMs,
        nodeReturnedEpochMs,
        error,
        ...(probe ? { protocol } : {}),
      };
    } else
      row = await page.evaluate(
        (options) => window.diagnose957(options),
        options
      );
    rows.push(row);
    console.log(JSON.stringify(row, null, 2));
    assert.equal(row.clicks, 1, "each call must click exactly once");
    assert.equal(row.effect, "Applied 1");
    assert.ok(
      row.marks.workReturned - row.marks.workStarted >= options.workMs,
      "the requested main-thread work must actually run"
    );
    if (options.workMs === 0)
      assert.ok(
        !row.error && !row.result?.isError,
        "fast control must succeed"
      );
    if (
      options.path === "host" &&
      options.workMs === 1400 &&
      !options.scheduling &&
      options.timeoutMs !== 0
    ) {
      assert.ok(
        row.timeOrigin + row.marks.effect < row.nodeReturnedEpochMs,
        "the click's effect must precede the host timeout response"
      );
      assert.ok(
        row.timeOrigin + row.marks.handlerReturned > row.nodeReturnedEpochMs,
        "the host must time out while the click handler is still running"
      );
    }
    await context.close();
  }
  const artifact = probe
    ? "host-protocol.json"
    : matrix
      ? "matrix.json"
      : "repro.json";
  await writeFile(
    new URL(artifact, import.meta.url),
    JSON.stringify({ metadata, rows }, null, 2) + "\n"
  );
  if (!matrix && !probe) {
    for (const row of rows) {
      const text = JSON.stringify(row.result);
      assert.ok(
        !(
          row.result?.isError &&
          text.includes("Timeout 1000ms exceeded") &&
          text.includes("performing click action") &&
          text.includes("Applied 1")
        ),
        "#957 REPRODUCED: click effect in the same isError result's Change Record"
      );
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
