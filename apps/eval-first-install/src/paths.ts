import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
export const appDir = join(packageDir, "fixture", "app");
export const projectTemplateDir = join(packageDir, "fixture", "project");
export const docPatch = join(packageDir, "doc-changes.patch");
export const recorder = join(packageDir, "src", "recorder.mjs");
export const approveMcpJson = join(packageDir, "src", "approve-mcp-json.mjs");
export const resultsDir = join(packageDir, "results");

/** The main checkout's root, also from a linked worktree. */
export function repoRoot(): string {
  const common = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: packageDir, encoding: "utf8" }
  ).trim();
  return dirname(common);
}
