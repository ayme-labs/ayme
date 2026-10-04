/**
 * The eval's own environment: the long-lived Claude Code token, and the
 * OpenRouter key it asks for the Goal Loop's cost with, read from the ignored
 * `.env.local` next to this package. As with the example apps' env files, a
 * variable already exported in the shell wins over the file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const tokenVariable = "CLAUDE_CODE_OAUTH_TOKEN";
/** The key the lab app's Decision Endpoint calls OpenRouter with; the eval reads cost records with the same one. */
export const openRouterKeyVariable = "AYME_OPENROUTER_API_KEY";
export const envFileName = ".env.local";

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
  parent: NodeJS.ProcessEnv = process.env
): string | undefined {
  const exported = parent[name];
  if (exported) return exported;
  return readEnvFile(directory)[name] || undefined;
}

/** The token, from the shell first and the env file second; `undefined` when neither has it. */
export function readOauthToken(
  directory: string,
  parent: NodeJS.ProcessEnv = process.env
): string | undefined {
  return readEnvVariable(tokenVariable, directory, parent);
}
