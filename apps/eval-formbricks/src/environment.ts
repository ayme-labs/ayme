/**
 * The eval's own environment: the long-lived Claude Code token, read from the
 * ignored `.env.local` next to this package. As with the example apps' env files, a
 * variable already exported in the shell wins over the file. Exported tokens
 * do not stay in `process.env`: see `withholdTokens`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const tokenVariable = "CLAUDE_CODE_OAUTH_TOKEN";
/** The optional second login's token; `login.ts` says when it is used. */
export const fallbackTokenVariable = "CLAUDE_CODE_OAUTH_TOKEN_FALLBACK";
/** A Codex access token, which runs on the ChatGPT workspace's plan, not on API billing. */
export const codexTokenVariable = "CODEX_ACCESS_TOKEN";
export const envFileName = ".env.local";

let withheld: NodeJS.ProcessEnv = {};

/**
 * Moves the exported tokens out of `process.env`, so no child process the
 * eval starts inherits them: not Docker, git, Chrome or `claude --version`.
 * The agent and its sign-in check get the one token they need from
 * `claudeEnvironment`. `runMain` calls this before every command.
 */
export function withholdTokens(environment: NodeJS.ProcessEnv = process.env) {
  withheld = {};
  for (const name of [
    tokenVariable,
    fallbackTokenVariable,
    codexTokenVariable,
  ]) {
    if (environment[name] !== undefined) withheld[name] = environment[name];
    delete environment[name];
  }
}

/** The shell's environment, with the tokens `withholdTokens` took out of it. */
export function shellEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, ...withheld };
}

/** `KEY=value` lines; `#` comments, an `export ` prefix and matching quotes are allowed. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line
    );
    if (match === null) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    values[key] = value;
  }
  return values;
}

export function readEnvFile(directory: string): Record<string, string> {
  try {
    return parseEnvFile(
      readFileSync(path.join(directory, envFileName), "utf8")
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** A variable from the shell first and the env file second; `undefined` when neither has it. */
export function readEnvVariable(
  name: string,
  directory: string,
  parent: NodeJS.ProcessEnv = shellEnvironment()
): string | undefined {
  const exported = parent[name];
  if (exported) return exported;
  return readEnvFile(directory)[name] || undefined;
}

/** The token, from the shell first and the env file second; `undefined` when neither has it. */
export function readOauthToken(
  directory: string,
  parent: NodeJS.ProcessEnv = shellEnvironment()
): string | undefined {
  return readEnvVariable(tokenVariable, directory, parent);
}
