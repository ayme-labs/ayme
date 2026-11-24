/**
 * The agents a mission can run through. Each has its own sign-in, checked
 * before a run, and its own environment, built around a fresh configuration
 * folder that holds nothing of the launcher's.
 */
import { claudeEnvironment } from "./claude.ts";
import {
  codexDefaultModel,
  codexEnvironment,
  codexTokenVariable,
  codexSignInPrecondition,
} from "./codex.ts";
import { readEnvVariable, readOauthToken } from "./environment.ts";
import { claudeTokenPrecondition, type Precondition } from "./preconditions.ts";

export const agentIds = ["claude", "codex"] as const;
export type AgentId = (typeof agentIds)[number];

export function isAgentId(value: string): value is AgentId {
  return (agentIds as readonly string[]).includes(value);
}

export const defaultModels: Record<AgentId, string> = {
  claude: "sonnet",
  codex: codexDefaultModel,
};

/**
 * The agent's environment around `configDir`, and the preconditions that
 * its sign-in works there. The environment is
 * `undefined` when there is nothing to sign in with; the precondition then
 * says so.
 */
export function agentAccess(options: {
  agent: AgentId;
  configDir: string;
  /** The directory holding the env file. */
  envDirectory: string;
}): {
  environment: NodeJS.ProcessEnv | undefined;
  preconditions: Precondition[];
} {
  const { configDir, envDirectory } = options;
  if (options.agent === "claude") {
    const oauthToken = readOauthToken(envDirectory);
    const environment =
      oauthToken === undefined
        ? undefined
        : claudeEnvironment({ configDir, oauthToken });
    return {
      environment,
      preconditions: [claudeTokenPrecondition({ environment, envDirectory })],
    };
  }
  const environment = codexEnvironment({ configDir });
  return {
    environment,
    preconditions: [
      codexSignInPrecondition({
        environment,
        configDir,
        accessToken: readEnvVariable(codexTokenVariable, envDirectory),
        envDirectory,
      }),
    ],
  };
}
