// Checks a package the prototype wrote against the released recorder's own
// code (v0.1.2), read from the read-only export. Nothing is copied: esbuild
// bundles the released TypeScript from the export path into the scratchpad and
// this script imports the bundle. Core and zod resolve to this repository's
// copies, so the released code works on the very tree objects the prototype
// holds (the export's vendored core source is identical to packages/core/src).
//
// Standalone:  node check-package.mjs <recordingId> [--root <dir>]
//   schema, stored layout, the released store's and trace command's reading
//   code, and the ref rules the shipped skill states.
// In-process:  node record-package.mjs --check
//   the above, plus the released text renderer and document renderer run over
//   the recording's own trees and compared with what the prototype wrote.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const require = createRequire(import.meta.url);
const SCRATCH = path.join(
  process.env.AYME_SCRATCH ??
    "<scratchpad>",
  `recorder-check-${process.pid}`
);
export const EXPORT =
  process.env.AYME_RELEASED_EXPORT ??
  "<scratchpad>/ayme-private-dev";

const store = path.join(repo, "node_modules/.pnpm");
const CORE = path.join(repo, "packages/core/dist/index.mjs");
const ZOD = fs.realpathSync(path.join(repo, "packages/core/node_modules/zod"));
const YAML = path.join(store, "yaml@2.9.0/node_modules/yaml");
const ESBUILD = path.join(store, "esbuild@0.28.2/node_modules/esbuild");

/** Bundles the released modules the check needs and imports them. */
export async function loadReleased() {
  const esbuild = require(ESBUILD);
  const src = (p) => path.join(EXPORT, p);
  const alias = {
    "ayme-recorder": src("packages/ayme-recorder/src/index.ts"),
    "ayme-recorder/internal": src("packages/ayme-recorder/src/internal.ts"),
    "ayme-live-session": src("packages/ayme-live-session/src/index.ts"),
    "ayme-ai-service/contracts": src(
      "packages/ayme-ai-service/src/contracts/index.ts"
    ),
    "@ayme/playwright-tracing": src(
      "packages/ayme-playwright-tracing/src/index.ts"
    ),
  };
  const external = {
    "@ayme-dev/core/structural-observation": CORE,
    zod: path.join(ZOD, "index.js"),
    yaml: path.join(YAML, "dist/index.js"),
  };
  const entry = path.join(SCRATCH, "released-entry.ts");
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(
    entry,
    [
      `export { RecordingPackageSchema, RecordingPackageIdSchema } from ${JSON.stringify(src("apps/ayme-cli/src/recording/schemas.ts"))};`,
      `export { RecordingStore, recordingIdOfStoredPackage } from ${JSON.stringify(src("apps/ayme-cli/src/recording/RecordingStore.ts"))};`,
      `export { runTraceCommand } from ${JSON.stringify(src("apps/ayme-cli/src/traceCommand.ts"))};`,
      `export { renderStructuralRecordingPackage } from ${JSON.stringify(src("packages/ayme-recorder/src/composition/application/tree-output/StructuralRecordingPackageRenderer.ts"))};`,
      `export { recordingOutput } from ${JSON.stringify(src("packages/ayme-recorder/src/composition/application/tree-output/recordingOutput.ts"))};`,
      `export { renderTree } from "@ayme-dev/core/structural-observation";`,
    ].join("\n")
  );
  // Everything else the released barrels pull in (the Playwright fork, the AI
  // service, the UI server) is not needed here and is replaced by inert stubs
  // that export whatever names their importers ask for.
  const stubNames = new Map();
  const noteNames = (specifier, importer) => {
    const names = stubNames.get(specifier) ?? new Set();
    stubNames.set(specifier, names);
    let source = "";
    try {
      source = fs.readFileSync(importer, "utf8");
    } catch {
      return;
    }
    const quoted = specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const statement = new RegExp(
      `(?:import|export)\\s+(?!type\\b)([^;]*?)\\s+from\\s+['"]${quoted}['"]`,
      "g"
    );
    for (const [, clause] of source.matchAll(statement))
      for (const part of clause.replace(/[{}]/g, ",").split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name) && !part.trim().startsWith("type "))
          names.add(name);
      }
  };
  const outfile = path.join(SCRATCH, "released-bundle.mjs");
  const options = {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    tsconfigRaw: "{}",
    plugins: [
      {
        name: "released",
        setup(build) {
          build.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.path.startsWith("node:")) return { external: true };
            if (external[args.path])
              return { path: external[args.path], external: true };
            if (alias[args.path]) return { path: alias[args.path] };
            if (require("node:module").isBuiltin(args.path))
              return { external: true };
            noteNames(args.path, args.importer);
            return { path: args.path, namespace: "stub" };
          });
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents:
              "const f = () => new Proxy(function () {}, { get: (t, k) => (k === 'prototype' ? t.prototype : k === Symbol.toPrimitive ? () => '' : f()), apply: () => f(), construct: () => ({}) });\n" +
              "export default f();\n" +
              [...(stubNames.get(args.path) ?? [])]
                .filter((name) => name !== "default")
                .map((name) => `export const ${name} = f();`)
                .join("\n"),
            loader: "js",
          }));
        },
      },
    ],
  };
  // first pass only collects the names the stubs must export
  await esbuild.build({ ...options, write: false }).catch(() => {});
  await esbuild.build(options);
  const stubbed = new Set(stubNames.keys());
  const released = await import(
    pathToFileURL(outfile).href + `?t=${Date.now()}`
  );
  return { released, stubbed: [...stubbed].sort() };
}

const lines = [];
const failures = [];
const say = (ok, what, detail = "") => {
  const line = `${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`;
  lines.push(line);
  if (!ok) failures.push(line);
  console.log(line);
};

/** The skill's rules about refs, checked on the stored text alone. */
export function checkRefRules(text) {
  const out = { visits: 0, interactions: 0, unresolved: [], ancestorOnly: [] };
  const visits = text.split(/\n {2}- visitId: /).slice(1);
  for (const body of visits) {
    out.visits += 1;
    const visitId = body.split("\n", 1)[0];
    const [baseline, timeline = ""] = body.split("\n    timelineEntries:");
    const known = new Set(
      [...baseline.matchAll(/\[ref=([^\]]+)\]/g)].map((m) => m[1])
    );
    for (const entry of timeline.split(/\n {6}- kind: /).slice(1)) {
      const target = /\n {10}targetRef: (\S+)/.exec(entry)?.[1];
      const id = /\n {10}id: (\S+)/.exec(entry)?.[1];
      if (id) {
        out.interactions += 1;
        if (target === "null") out.unresolved.push(`${visitId} ${id}: null`);
        else if (target !== undefined && !known.has(target))
          out.unresolved.push(`${visitId} ${id}: ${target} not seen before it`);
      }
      for (const m of entry.matchAll(/<added> \[ref=([^\]]+)\]/g))
        known.add(m[1]);
    }
  }
  return out;
}

function listFiles(dir, base = dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? listFiles(path.join(dir, e.name), base)
        : [path.relative(base, path.join(dir, e.name))]
    )
    .sort();
}

/** Checks that need only what is on disk. */
export async function checkStored({ root, recordingId, document, released }) {
  const dir = path.join(root, ".ayme", "recordings", recordingId);
  const text = fs.readFileSync(path.join(dir, "package.yaml"), "utf8");

  // 1. the released schema, on the JSON document of the same recording
  const parsed = released.RecordingPackageSchema.safeParse(document);
  say(
    parsed.success,
    "released RecordingPackageSchema accepts the document",
    parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))
  );
  if (parsed.success) {
    // zod drops keys the schema does not know: none may have been dropped
    const dropped = !isDeepStrictEqual(
      JSON.parse(JSON.stringify(parsed.data)),
      JSON.parse(JSON.stringify(document))
    );
    say(!dropped, "the schema dropped no field of the document");
  }

  // 2. the released store's reading code, on the prototype's directory
  const releasedStore = new released.RecordingStore(root);
  const latest = await releasedStore.readLatestPackage();
  say(
    latest.mediaType === "application/yaml" && latest.text === text,
    "released store reads latest.yaml as the structural package"
  );
  const byId = await releasedStore.readPackageById(recordingId);
  say(byId.text === text, "released store reads the package by id");
  say(
    released.recordingIdOfStoredPackage(latest) === recordingId,
    "released code reads the recording id off the first line"
  );
  say(
    (await releasedStore.listRecordingIds()).includes(recordingId),
    "released store lists the recording id"
  );
  const manifest = releasedStore.traceManifest(recordingId);
  say(manifest.available === true, "released store finds the trace archive");
  const header = (key) => new RegExp(`^${key}: (.*)$`, "m").exec(text)?.[1];
  say(
    header("tracePath") === releasedStore.tracePath(recordingId),
    "tracePath is what the released store would write",
    header("tracePath")
  );
  say(
    fs.existsSync(releasedStore.resolveStoredPath(header("tracePath"))),
    "tracePath resolves to the stored trace.zip"
  );

  // 3. the released `trace open` target resolution (the Playwright call is stubbed)
  for (const target of ["latest", recordingId]) {
    let resolved = null;
    const code = await released.runTraceCommand({
      cwd: root,
      args: ["open", target],
      runPlaywright: async (args) => ((resolved = args), 0),
      error: (message) => (resolved = message),
    });
    say(
      code === 0 && resolved?.[1] === path.join(dir, "trace.zip"),
      `released \`trace open ${target === "latest" ? "latest" : "<id>"}\` resolves to the stored trace`,
      JSON.stringify(resolved)
    );
  }

  // 4. what the released store writes for the same package, file for file
  const twin = path.join(SCRATCH, "released-store-twin");
  fs.rmSync(twin, { recursive: true, force: true });
  await new released.RecordingStore(twin).save(parsed.data ?? document, {
    packageText: text,
    traceBytes: fs.readFileSync(path.join(dir, "trace.zip")),
  });
  const theirs = listFiles(path.join(twin, ".ayme"));
  const ours = listFiles(path.join(root, ".ayme")).filter(
    (f) =>
      !f.startsWith("recordings/rec_") ||
      f.startsWith(`recordings/${recordingId}/`)
  );
  // `.ayme/.gitignore` (browser-profile/, recordings/, tmp/, .gitignore) is the
  // released workspace's housekeeping; the prototype leaves it out so the
  // recorded package stays visible in this repository.
  const packageFiles = (files) => files.filter((f) => f !== ".gitignore");
  say(
    isDeepStrictEqual(packageFiles(theirs), ours),
    "same recording files as the released store writes",
    `released: ${theirs.join(", ")} | prototype: ${ours.join(", ")}`
  );

  // 5. the ref rules the shipped skill states
  const refs = checkRefRules(text);
  say(
    refs.unresolved.length === 0,
    `every targetRef names a node of the baseline or one added earlier in its visit (${refs.interactions} interactions, ${refs.visits} visits)`,
    refs.unresolved.join("; ")
  );
  return { text, refs };
}

/** Checks that need the recording's own trees: run from record-package.mjs. */
export async function checkAgainstReleased({ result, saved, side }) {
  const { released, stubbed } = await loadReleased();
  console.log(`released code loaded from ${EXPORT}`);
  const root = path.resolve(saved.dir, "../../..");
  await checkStored({
    root,
    recordingId: saved.recordingId,
    document: saved.document,
    released,
  });

  // the released recorder's own result shape, from the same trees
  const recordingResult = {
    mode: "structural",
    visits: result.model.visits.map((visit) => ({
      visitId: visit.visitId,
      url: visit.url,
      cause: visit.cause,
      baselineTree: visit.baselineTree,
      timelineEntries: visit.timelineEntries.map((entry) => ({
        kind: entry.kind,
        analysisItemId: entry.analysisItemId,
        timestamp: entry.timestamp,
        beforeTree: entry.beforeTree,
        afterTree: entry.afterTree,
        changeTree: entry.changeTree,
        ...(entry.kind === "interaction"
          ? { interaction: entry.interaction }
          : {}),
      })),
    })),
    traceArchive: null,
    traceActionPoints: saved.traceActionPoints,
  };
  const theirText = released.renderStructuralRecordingPackage(
    recordingResult,
    saved.header
  );
  fs.writeFileSync(
    path.join(side, "package.released-renderer.yaml"),
    theirText
  );
  say(
    theirText === saved.text,
    "the released text renderer writes the same package text, byte for byte",
    theirText === saved.text
      ? `${saved.text.length} bytes`
      : `see ${path.join(side, "package.released-renderer.yaml")}`
  );
  const theirDocument = released.RecordingPackageSchema.parse({
    ...released.renderTree(released.recordingOutput, recordingResult),
    recordingId: saved.header.recordingId,
    createdAt: saved.header.createdAt,
    url: saved.header.url,
    tracePath: saved.header.tracePath,
  });
  const same = isDeepStrictEqual(
    JSON.parse(JSON.stringify(theirDocument)),
    JSON.parse(JSON.stringify(saved.document))
  );
  if (!same)
    fs.writeFileSync(
      path.join(side, "document.released-renderer.json"),
      JSON.stringify(theirDocument, null, 1)
    );
  say(same, "the released document renderer builds the same JSON document");
  finish(side, stubbed);
}

function finish(side, stubbed) {
  const report = [
    ...lines,
    "",
    `${failures.length === 0 ? "all checks passed" : `${failures.length} check(s) failed`}`,
    `stubbed while bundling the released code (not used by it here): ${stubbed.join(", ")}`,
  ].join("\n");
  if (side) fs.writeFileSync(path.join(side, "check.txt"), report + "\n");
  console.log(failures.length === 0 ? "all checks passed" : "CHECKS FAILED");
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? fallback : process.argv[i + 1];
  };
  const root = path.resolve(arg("root", path.join(here, "skill-check")));
  const recordingId =
    process.argv[2] && !process.argv[2].startsWith("--")
      ? process.argv[2]
      : fs
          .readFileSync(path.join(root, ".ayme/recordings/latest.yaml"), "utf8")
          .split("\n", 1)[0]
          .replace("recordingId: ", "");
  const side = path.join(here, "out", "package", recordingId);
  const document = JSON.parse(
    fs.readFileSync(path.join(side, "document.json"), "utf8")
  );
  const { released, stubbed } = await loadReleased();
  console.log(`released code loaded from ${EXPORT}`);
  await checkStored({ root, recordingId, document, released });
  finish(null, stubbed);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
