// Investigation only. Run inside Devbox; see README.md for modes and expected exits.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { writeFileSync, readFileSync } from "node:fs";
const require = createRequire(
  new URL("../../packages/ayme/package.json", import.meta.url)
);
const { chromium } = require("playwright");
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(
  pathToFileURL(viteRequire.resolve("vite"))
);
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: "127.0.0.1", port: 47321, strictPort: true },
  optimizeDeps: { noDiscovery: true },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("pageerror", (error) => console.error(error.message));
const mode = process.argv[2] ?? "repro";
const results = [];
writeFileSync(
  new URL("./versions.json", import.meta.url),
  JSON.stringify(
    {
      node: process.version,
      playwright: require("playwright/package.json").version,
      chromium: browser.version(),
      lite: JSON.parse(
        readFileSync(
          new URL(
            "../../packages/ayme/node_modules/@ayme-dev/playwright-lite/package.json",
            import.meta.url
          )
        )
      ).version,
      platform: process.platform,
      arch: process.arch,
    },
    null,
    2
  ) + "\n"
);
try {
  await page.goto("http://127.0.0.1:47321/");
  await page.evaluate(async () => {
    globalThis.fixture = await import("/investigations/issue-1021/fixture.ts");
  });
  const run = async (options) => {
    const result = await page.evaluate(
      (options) => fixture.runCase(options),
      options
    );
    results.push(result);
    console.log(JSON.stringify(result));
    return result;
  };
  if (mode === "repro") {
    // Representative fixture: one locator member and three actions per row.
    const small = await run({ rows: 12 });
    const large = await run({ rows: 24 });
    for (const result of [small, large]) {
      assert.equal(result.observations, 1);
      assert.equal(result.observedRows, result.rows);
    }
    console.log(
      `candidate growth = ${(large.candidates / small.candidates).toFixed(3)}x`
    );
    assert(
      large.candidates <= small.candidates * 2.5,
      `#1021 RED: ${small.candidates} -> ${large.candidates} selector candidates for 2x rows`
    );
  } else if (mode === "minimal") {
    const options = { members: false, actions: false, plainRows: true };
    const small = await run({ rows: 4, ...options });
    const large = await run({ rows: 8, ...options });
    assert(
      large.candidates <= small.candidates * 2.5,
      `#1021 RED minimal: ${small.candidates} -> ${large.candidates} selector candidates for 2x rows`
    );
  } else if (mode === "matrix") {
    for (const rows of [12, 24, 48, 96]) await run({ rows });
    for (const options of [
      { members: false },
      { actions: false },
      { kind: "css" },
      { registered: false },
      { uniqueRoots: true },
      { operation: "targets" },
      { operation: "snapshot" },
      { operation: "hover" },
      { operation: "hover", registered: false },
      { operation: "probe", mutate: true },
    ])
      await run({ rows: 24, ...options });
  } else if (mode === "control") {
    for (const rows of [12, 24, 48, 96]) await run({ rows, lightRoots: true });
    assert(
      results.at(-1).candidates <= results[0].candidates * 8.1,
      "Light-DOM control should scale linearly"
    );
  } else if (mode === "timing") {
    for (const rows of [24, 48, 96, 192])
      for (const kind of ["role", "css"]) {
        for (let repeat = 0; repeat < 3; repeat++)
          await run({ rows, kind, instrumented: false });
      }
  } else if (mode === "profile") {
    await run({ rows: 24, instrumented: false });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await page.exposeFunction("startDiagnosticProfile", () =>
      cdp.send("Profiler.start")
    );
    await run({ rows: 192, instrumented: false });
    const { profile } = await cdp.send("Profiler.stop");
    writeFileSync(
      new URL("./profile.cpuprofile", import.meta.url),
      JSON.stringify(profile)
    );
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const parents = new Map(
      profile.nodes.flatMap((node) =>
        (node.children ?? []).map((child) => [child, node.id])
      )
    );
    const self = {},
      inclusive = {};
    profile.samples.forEach((id, i) => {
      const delta = profile.timeDeltas[i] / 1000;
      const name = nodes.get(id).callFrame.functionName || "anonymous";
      self[name] = (self[name] ?? 0) + delta;
      const seen = new Set();
      for (let current = id; current; current = parents.get(current))
        seen.add(nodes.get(current).callFrame.functionName || "anonymous");
      for (const ancestor of seen)
        inclusive[ancestor] = (inclusive[ancestor] ?? 0) + delta;
    });
    const summary = {
      topSelfMs: Object.entries(self)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
      selectedInclusiveMs: Object.fromEntries(
        [
          "observePomRoot",
          "resolveAll",
          "walkMembers",
          "count",
          "isVisible",
          "measurePomRoot",
          "_queryCSS",
          "getAriaRole",
          "queryAll",
          "query",
        ].map((name) => [name, inclusive[name] ?? 0])
      ),
    };
    writeFileSync(
      new URL("./profile-summary.json", import.meta.url),
      JSON.stringify(summary, null, 2) + "\n"
    );
    console.log(JSON.stringify(summary));
  } else if (mode === "parity") {
    const fixtureSource = await page.evaluate(() => ({
      html: fixture.html.toString(),
      probe: fixture.domProbe.toString(),
    }));
    for (const rows of [12, 24])
      for (const kind of ["role", "css"]) {
        const lite = await page.evaluate(
          ({ rows, kind }) => fixture.liteSequence(rows, kind),
          { rows, kind }
        );
        const realPage = await browser.newPage();
        const cdp = await realPage.context().newCDPSession(realPage);
        const contexts = new Map();
        cdp.on("Runtime.executionContextCreated", ({ context }) =>
          contexts.set(context.id, context)
        );
        await cdp.send("Runtime.enable");
        await realPage.setContent(
          await page.evaluate((rows) => fixture.html(rows), rows)
        );
        await realPage.locator("body").count();
        const utility = [...contexts.values()].find((context) =>
          context.name.includes("utility")
        );
        assert(utility, "Playwright utility world not found");
        await cdp.send("Runtime.evaluate", {
          contextId: utility.id,
          expression: `globalThis.diagnosticProbe = (${fixtureSource.probe})()`,
        });
        await realPage.evaluate(
          (source) => (globalThis.diagnosticProbe = eval(`(${source})()`)),
          fixtureSource.probe
        );
        const start = performance.now();
        const list =
          kind === "role"
            ? realPage
                .getByRole("list", { name: "Projects" })
                .locator(":scope > li")
            : realPage.locator('ul[aria-label="Projects"] > li');
        for (const root of await list.all()) {
          await root.count();
          await root.evaluateAll((elements) => elements.length);
          await root.isVisible();
          await root.evaluateAll((elements) => elements.length);
          const button = root.getByRole("button");
          await button.evaluateAll((elements) => elements.length);
          await button.count();
        }
        const ms = +(performance.now() - start).toFixed(2);
        const { result } = await cdp.send("Runtime.evaluate", {
          contextId: utility.id,
          expression: "JSON.stringify(diagnosticProbe.stats)",
          returnByValue: true,
        });
        const main = await realPage.evaluate(() => diagnosticProbe.stats);
        const dom = JSON.parse(result.value);
        for (const [key, value] of Object.entries(main)) {
          const entry = (dom[key] ??= { calls: 0, candidates: 0 });
          entry.calls += value.calls;
          entry.candidates += value.candidates;
        }
        const real = {
          rows,
          kind,
          ms,
          dom,
          worlds: { utility: JSON.parse(result.value), main },
        };
        const resultPair = { lite, real };
        results.push(resultPair);
        console.log(JSON.stringify(resultPair));
        // Same DOM traversals, despite transport and injected-version differences.
        assert.deepEqual(real.dom, lite.dom);
        await realPage.close();
      }
  } else throw new Error(`Unknown mode ${mode}`);
} finally {
  writeFileSync(
    new URL(`./${mode}.json`, import.meta.url),
    JSON.stringify(results, null, 2) + "\n"
  );
  await browser.close();
  await server.close();
}
