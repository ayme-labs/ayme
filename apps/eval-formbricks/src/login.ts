/**
 * The eval's two Claude Code logins. A run always tries the first; when that
 * attempt ends on a usage limit, the attempt is thrown away and the whole run
 * is done again, from the start, on the second. Without a second token a
 * limit is handled as any other failure of the run. A token reaches only the
 * agent's environment and the `claude auth status` check; what this module
 * records is the login's name.
 */
import {
  fallbackTokenVariable,
  isOauthTokenShape,
  readEnvVariable,
  readOauthToken,
  tokenVariable,
} from "./environment.ts";

export type LoginName = "first" | "fallback";

export type Login = {
  name: LoginName;
  /** The variable that holds this login's token, for messages. */
  variable: string;
  /** `undefined` only for a first login that is not configured; the token precondition reports that. */
  token: string | undefined;
  /** Every configured token; the agent's output is scrubbed of all of them before it is kept. */
  secrets: string[];
  /** A second login is configured, so a limit on this one is repeated instead of handled here. */
  hasFallback: boolean;
};

/** The attempt ended on the first login's usage limit and the run is to be repeated on the second. */
export class UsageLimitError extends Error {}

/**
 * The error that ends an attempt which hit a usage limit, or `null` when the
 * attempt stands: it did not hit one, or the first login has no fallback.
 */
export function usageLimitError(
  run: { usageLimited?: boolean },
  login: Login,
  where: string
): Error | null {
  if (!run.usageLimited) return null;
  if (login.name === "fallback")
    return new Error(
      `Both Claude Code logins are at their usage limit, so the run cannot complete. The transcript is in ${where}.`
    );
  return login.hasFallback
    ? new UsageLimitError("The first login is at its usage limit.")
    : null;
}

/** A configured token must look like one; the message names the variable and never the value. */
function checkedToken(
  token: string | undefined,
  variable: string
): string | undefined {
  if (token === undefined || isOauthTokenShape(token)) return token;
  throw new Error(
    `${variable} does not have the shape of a Claude Code token (sk-ant-oat...). Create one with \`claude setup-token\`.`
  );
}

/**
 * Both configured tokens, each checked for its shape, before anything uses
 * either: a malformed one is refused here, by variable name, whichever of the
 * two it is. A token that is not configured is `undefined`.
 */
export function readLoginTokens(
  directory: string,
  parent: NodeJS.ProcessEnv = process.env
) {
  return {
    first: checkedToken(readOauthToken(directory, parent), tokenVariable),
    fallback: checkedToken(
      readEnvVariable(fallbackTokenVariable, directory, parent),
      fallbackTokenVariable
    ),
  };
}

/** Runs the attempt on the first login, and once more on the second when the first ended on a usage limit. */
export async function withFallbackLogin<T>(
  directory: string,
  attempt: (login: Login) => Promise<T>,
  log: (line: string) => void,
  parent: NodeJS.ProcessEnv = process.env
): Promise<T> {
  const { first, fallback } = readLoginTokens(directory, parent);
  const secrets = [first, fallback].filter(
    (token): token is string => token !== undefined
  );
  try {
    return await attempt({
      name: "first",
      variable: tokenVariable,
      token: first,
      secrets,
      hasFallback: fallback !== undefined,
    });
  } catch (error) {
    if (!(error instanceof UsageLimitError)) throw error;
  }
  log(
    "The first login is at its usage limit; repeating the run from the start on the fallback login."
  );
  return attempt({
    name: "fallback",
    variable: fallbackTokenVariable,
    token: fallback,
    secrets,
    hasFallback: false,
  });
}
