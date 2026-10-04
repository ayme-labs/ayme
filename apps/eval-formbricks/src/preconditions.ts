/**
 * What a run needs before anything starts. Each check returns the problem as
 * a sentence, or `null` when it holds; the run names every missing one.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { claudeAuthStatus, claudeVersion } from "./claude.ts";

export type Precondition = {
  name: string;
  check: () => Promise<string | null> | string | null;
};

export function claudeLoginPrecondition(configDir: string): Precondition {
  return {
    name: "Claude Code login",
    check: () => {
      if (claudeVersion() === null)
        return "Claude Code is not installed: `claude --version` failed.";
      const status = claudeAuthStatus(configDir);
      if (status === null)
        return "Claude Code did not report its authentication status.";
      if (!status.loggedIn)
        return `Claude Code is not logged in for the eval's isolated configuration. Run: CLAUDE_CONFIG_DIR=${configDir} claude auth login`;
      return null;
    },
  };
}

export const dockerPrecondition: Precondition = {
  name: "Docker",
  check: () => {
    const result = spawnSync("docker", ["info"], { encoding: "utf8" });
    if (result.error || result.status !== 0)
      return "Docker is not running. Start Docker Desktop.";
    return null;
  },
};

export function labAppPrecondition(baseUrl: string): Precondition {
  return {
    name: "Lab app",
    check: async () => {
      try {
        const response = await fetch(`${baseUrl}/auth/login`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          return `The lab app at ${baseUrl} answered HTTP ${response.status}. Run pnpm lab:dev in apps/lab-formbricks.`;
        return null;
      } catch {
        return `The lab app is not reachable at ${baseUrl}. Run pnpm lab:dev in apps/lab-formbricks.`;
      }
    },
  };
}

export function formbricksPreparedPrecondition(
  formbricksRoot: string
): Precondition {
  return {
    name: "Formbricks checkout",
    check: () => {
      if (!existsSync(path.join(formbricksRoot, ".git")))
        return "The Formbricks submodule is not checked out. Run pnpm lab:prepare in apps/lab-formbricks.";
      if (!existsSync(path.join(formbricksRoot, "node_modules")))
        return "Formbricks's dependencies are not installed. Run pnpm lab:prepare in apps/lab-formbricks.";
      if (!existsSync(path.join(formbricksRoot, ".env")))
        return "Formbricks has no .env. Copy it from the checkout that started the lab stack.";
      return null;
    },
  };
}

export class PreconditionError extends Error {
  constructor(problems: { name: string; problem: string }[]) {
    super(
      [
        "Cannot start the run:",
        ...problems.map(({ name, problem }) => `- ${name}: ${problem}`),
      ].join("\n")
    );
    this.name = "PreconditionError";
  }
}

export async function checkPreconditions(preconditions: Precondition[]) {
  const problems: { name: string; problem: string }[] = [];
  for (const precondition of preconditions) {
    const problem = await precondition.check();
    if (problem !== null) problems.push({ name: precondition.name, problem });
  }
  if (problems.length > 0) throw new PreconditionError(problems);
}
