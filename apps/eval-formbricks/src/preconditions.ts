/**
 * What a run needs before anything starts. Each check returns the problem as
 * a sentence, or `null` when it holds; the run names every missing one.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { claudeAuthStatus, claudeVersion } from "./claude.ts";
import { envFileName, tokenVariable } from "./environment.ts";
import type { LabChanges } from "./labCheckout.ts";

export type Precondition = {
  name: string;
  check: () => Promise<string | null> | string | null;
};

/**
 * The eval's long-lived Claude Code token must be present, and Claude Code must
 * accept it in the agent's environment. The token itself is never repeated.
 */
export function claudeTokenPrecondition(options: {
  /** The agent's environment, or `undefined` when there is no token to build it from. */
  environment: NodeJS.ProcessEnv | undefined;
  /** The directory holding the env file, for the message. */
  envDirectory: string;
}): Precondition {
  const envFile = path.join(options.envDirectory, envFileName);
  return {
    name: "Claude Code token",
    check: () => {
      if (options.environment === undefined)
        return `No ${tokenVariable}. Create a token with \`claude setup-token\` and put \`${tokenVariable}=<token>\` in ${envFile} (ignored by git), or export the variable.`;
      if (claudeVersion() === null)
        return "Claude Code is not installed: `claude --version` failed.";
      const status = claudeAuthStatus(options.environment);
      if (status === null)
        return "Claude Code did not report its authentication status.";
      if (!status.loggedIn)
        return `Claude Code does not accept the ${tokenVariable} from ${envFile}. Create a new one with \`claude setup-token\`.`;
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

/** The lab app folder, submodule included, has no untracked or modified file: the agent starts from the checkout as committed. */
export function labCheckoutCleanPrecondition(
  read: () => LabChanges
): Precondition {
  return {
    name: "Lab app checkout",
    check: () => {
      const { untracked, modified } = read();
      if (untracked.length === 0 && modified.length === 0) return null;
      const list = (files: string[]) =>
        files.slice(0, 5).join(", ") +
        (files.length > 5 ? `, and ${files.length - 5} more` : "");
      return `apps/lab-formbricks has changes the agent would see: ${[
        untracked.length > 0 ? `untracked ${list(untracked)}` : null,
        modified.length > 0 ? `modified ${list(modified)}` : null,
      ]
        .filter((part) => part !== null)
        .join("; ")}. Move or restore them first.`;
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
