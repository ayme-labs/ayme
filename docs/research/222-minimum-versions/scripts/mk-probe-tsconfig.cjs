// Writes standalone probe tsconfigs (no extends of the repo's ES2024 library config) for older TypeScript.
const fs = require("fs");
const root = require("child_process")
  .execSync("git rev-parse --show-toplevel")
  .toString()
  .trim();
const base = {
  strict: true,
  skipLibCheck: true,
  verbatimModuleSyntax: true,
  module: "ESNext",
  moduleResolution: "Bundler",
  target: "ES2022",
};
for (const [a, f] of [
  ["next", "tsconfig.json"],
  ["next", "tsconfig.pom.json"],
  ["nuxt", "tsconfig.pom.json"],
]) {
  const src = JSON.parse(
    fs.readFileSync(`${root}/apps/example-${a}/${f}`, "utf8")
  );
  const co = { ...base, ...src.compilerOptions };
  delete co.plugins;
  delete co.incremental;
  fs.writeFileSync(
    `${root}/apps/example-${a}/probe-ts-${f}`,
    JSON.stringify(
      { compilerOptions: co, include: src.include, exclude: src.exclude },
      null,
      2
    )
  );
}
