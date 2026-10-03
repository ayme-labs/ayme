#!/usr/bin/env node
// One packed-consumer probe for #221.
//
//   node probe.mjs <candidate.json>
//
// The candidate file names the framework fixture, the packed tarball dir, the
// exact consumer dependencies and the client variant. The consumer installs
// only the packed tarballs and its declared dependencies, with strict peers,
// then runs: typecheck (skipLibCheck false) -> client build -> SSR build ->
// DOM-free prerender -> Playwright browser lifecycle on CSR and hydrated SSR.
// Each step logs to logs/<label>/<step>.log; a summary row is appended to
// results.tsv. Steps after the first failure are reported as "skipped".
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidate = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const {
  label,
  framework,
  pack,
  client,
  dependencies,
  devDependencies = {},
  typescript = "6.0.3",
  peerDependencyRules,
  overrides: extraOverrides = {},
  env: extraEnv = {},
  skip = [],
} = candidate;
const scratch = process.env.PROBE_SCRATCH;
if (!scratch) throw new Error("PROBE_SCRATCH is required");
const consumer = path.join(scratch, "consumers", label);
const logs = path.join(here, "logs", label);
fs.rmSync(consumer, { recursive: true, force: true });
fs.rmSync(logs, { recursive: true, force: true });
fs.mkdirSync(consumer, { recursive: true });
fs.mkdirSync(logs, { recursive: true });

const fixture = path.join(here, "fixtures", framework);
const shared = path.join(here, "fixtures", "shared");
fs.cpSync(fixture, consumer, { recursive: true });
fs.mkdirSync(path.join(consumer, "tests"), { recursive: true });
fs.copyFileSync(
  path.join(shared, "CounterPage.ts"),
  path.join(consumer, "src/CounterPage.ts")
);
fs.copyFileSync(
  path.join(shared, "consumer.spec.ts"),
  path.join(consumer, "tests/consumer.spec.ts")
);
for (const f of ["playwright.config.ts", "prerender.mjs", "index.html"])
  fs.copyFileSync(path.join(shared, f), path.join(consumer, f));
const srcDir = path.join(consumer, "src");
fs.copyFileSync(
  path.join(srcDir, `client.${client}.ts`),
  path.join(srcDir, "client.ts")
);
for (const f of fs.readdirSync(srcDir))
  if (/^client\..+\.ts$/.test(f)) fs.rmSync(path.join(srcDir, f));

const tarballs = path.join(scratch, pack, "tarballs");
const tgz = (name) =>
  `file:${path.join(tarballs, `ayme-dev-${name}-0.1.0.tgz`)}`;
const overrides = Object.fromEntries(
  ["ayme", "inspector", "vue", "react", "unplugin-ayme"].map((n) => [
    `@ayme-dev/${n}`,
    tgz(n),
  ])
);
Object.assign(overrides, extraOverrides);
fs.writeFileSync(
  path.join(consumer, "package.json"),
  JSON.stringify(
    {
      name: `probe-${label}`,
      private: true,
      type: "module",
      dependencies: {
        "@ayme-dev/ayme": tgz("ayme"),
        [`@ayme-dev/${framework}`]: tgz(framework),
        ...dependencies,
      },
      devDependencies: {
        "@ayme-dev/unplugin-ayme": tgz("unplugin-ayme"),
        "@playwright/test": "1.62.1",
        "@types/node": "24.13.3",
        typescript,
        vite: "8.2.2",
        ...devDependencies,
      },
    },
    null,
    2
  )
);
let workspace = `overrides:\n${Object.entries(overrides)
  .map(([n, t]) => `  '${n}': '${t}'`)
  .join("\n")}\n`;
if (peerDependencyRules)
  workspace += `peerDependencyRules:\n${JSON.stringify(
    peerDependencyRules
  ).replace(/^/, "  ")}\n`;
fs.writeFileSync(path.join(consumer, "pnpm-workspace.yaml"), workspace);

const env = {
  ...process.env,
  NODE_PATH: "",
  NODE_ENV: "development",
  ...extraEnv,
};
const port = String(4300 + Math.floor(Math.random() * 600));
const steps = [
  [
    "install",
    "pnpm",
    [
      "install",
      "--ignore-scripts",
      "--no-lockfile",
      "--strict-peer-dependencies",
    ],
  ],
  ["typecheck", "pnpm", ["exec", "tsc", "-p", "tsconfig.json"]],
  ["build", "pnpm", ["exec", "vite", "build", "--mode", "development"]],
  [
    "ssr-build",
    "pnpm",
    [
      "exec",
      "vite",
      "build",
      "--mode",
      "development",
      "--ssr",
      "src/server.ts",
      "--outDir",
      "dist-ssr",
    ],
  ],
  ["ssr", process.execPath, ["prerender.mjs"]],
  ["browser", "pnpm", ["exec", "playwright", "test"]],
];
const results = {};
let failed = false;
for (const [name, file, args] of steps) {
  if (failed || skip.includes(name)) {
    results[name] = skip.includes(name) ? "not-run" : "skipped";
    continue;
  }
  const run = spawnSync(file, args, {
    cwd: consumer,
    env: { ...env, PROBE_PORT: port },
    encoding: "utf8",
    // Allow `install` to clear prior partial state.
    timeout: 300_000,
  });
  const out = `$ ${file} ${args.join(" ")}\n# cwd ${consumer}\n${run.stdout ?? ""}\n${run.stderr ?? ""}\nexit ${run.status}\n`;
  fs.writeFileSync(path.join(logs, `${name}.log`), out);
  results[name] = run.status === 0 ? "pass" : "FAIL";
  if (run.status !== 0) failed = true;
}
for (const f of fs.readdirSync(consumer))
  if (/^console-.*\.log$/.test(f))
    fs.copyFileSync(path.join(consumer, f), path.join(logs, f));
const ls = spawnSync("pnpm", ["list", "--depth", "0", "--json"], {
  cwd: consumer,
  encoding: "utf8",
});
fs.writeFileSync(path.join(logs, "installed.json"), ls.stdout ?? "");
fs.writeFileSync(
  path.join(logs, "candidate.json"),
  JSON.stringify(candidate, null, 2)
);
const row = [label, ...steps.map(([n]) => `${n}=${results[n]}`)].join("\t");
fs.appendFileSync(path.join(here, "results.tsv"), row + "\n");
console.log(row);
