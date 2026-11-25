/**
 * The eval's two Claude Code logins. A run always tries the first; when that
 * attempt ends on a usage limit, the attempt is thrown away and the whole run
 * is done again, from the start, on the second. Without a second token a
 * limit is handled as any other failure of the run.
 */
import {
  fallbackTokenVariable,
  readEnvVariable,
  readOauthToken,
  shellEnvironment,
  tokenVariable,
} from "./environment.ts";

export type LoginName = "first" | "fallback";

export type Login = {
  name: LoginName;
  /** The variable that holds this login's token, for messages. */
  variable: string;
  /** `undefined` only for a first login that is not configured; the token precondition reports that. */
  token: string | undefined;
  /** Whether a limit on this login is repeated on another instead of handled here; asked only after a limit. */
  hasFallback: () => boolean;
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
  return login.hasFallback()
    ? new UsageLimitError("The first login is at its usage limit.")
    : null;
}

/**
 * Runs the attempt on the first login, and once more on the second when the
 * first ended on a usage limit. An attempt that fails to clean up after itself
 * throws that failure instead, so the run is not repeated on what it left behind.
 */
export async function withFallbackLogin<T>(
  directory: string,
  attempt: (login: Login) => Promise<T>,
  log: (line: string) => void,
  parent: NodeJS.ProcessEnv = shellEnvironment()
): Promise<T> {
  // Read once, and only after a limit: a run the first login serves does not depend on the second token's source.
  let fallbackToken: { value: string | undefined } | undefined;
  const fallback = () => {
    if (fallbackToken === undefined) {
      try {
        fallbackToken = {
          value: readEnvVariable(fallbackTokenVariable, directory, parent),
        };
      } catch (error) {
        log(
          `The fallback login cannot be read, so the limit is handled as without one: ${(error as Error).message}`
        );
        fallbackToken = { value: undefined };
      }
    }
    return fallbackToken.value;
  };
  try {
    return await attempt({
      name: "first",
      variable: tokenVariable,
      token: readOauthToken(directory, parent),
      hasFallback: () => fallback() !== undefined,
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
    token: fallback(),
    hasFallback: () => false,
  });
}
