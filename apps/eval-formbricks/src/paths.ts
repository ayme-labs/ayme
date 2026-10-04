import path from "node:path";
import { fileURLToPath } from "node:url";

/** This package. Missions, results and transcripts live under it, never under the lab app. */
export const evalRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
export const repoRoot = path.resolve(evalRoot, "../..");

/** The agent's working root: the lab app and nothing else. */
export const labRoot = path.join(repoRoot, "apps/lab-formbricks");
/** The Formbricks submodule checkout inside the lab app. */
export const formbricksRoot = path.join(labRoot, "formbricks");

/** Ignored by git. One folder per run, plus the eval's own Claude Code configuration. */
export const resultsRoot = path.join(evalRoot, "results");
export const runsRoot = path.join(resultsRoot, "runs");
export const claudeConfigDir = path.join(resultsRoot, "claude-config");

export const labUrl = "http://localhost:3000";
