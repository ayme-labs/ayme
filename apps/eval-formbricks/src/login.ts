/**
 * The eval's two Claude Code logins. A run always tries the first; when that
 * attempt ends on a usage limit, the attempt is thrown away and the whole run
 * is done again, from the start, on the second. Without a second token a
 * limit is handled as any other failure of the run. A token reaches only the
 * agent's environment; what this module records is the login's name.
 */
import {
  fallbackTokenVariable,
  readEnvVariable,
  readOauthToken,
} from "./environment.ts";

export type LoginName = "first" | "fallback";

export type Login = {
  name: LoginName;
  /** `undefined` only for a first login that is not configured; the token precondition reports that. */
  token: string | undefined;
  /** Another login follows this one. */
  hasNext: boolean;
};

/** The attempt ended on the first login's usage limit and the run is to be repeated on the next. */
export class UsageLimitError extends Error {}

/** The first login, then the fallback when its token is configured. */
export function readLogins(
  directory: string,
  parent: NodeJS.ProcessEnv = process.env
): Login[] {
  const fallback = readEnvVariable(fallbackTokenVariable, directory, parent);
  return [
    {
      name: "first",
      token: readOauthToken(directory, parent),
      hasNext: fallback !== undefined,
    },
    ...(fallback === undefined
      ? []
      : [{ name: "fallback" as const, token: fallback, hasNext: false }]),
  ];
}

/**
 * The error that ends an attempt which hit a usage limit, or `null` when the
 * attempt stands: it did not hit one, or it is the only login there is.
 */
export function usageLimitError(
  run: { usageLimited: boolean },
  login: Login,
  where: string
): Error | null {
  if (!run.usageLimited) return null;
  if (login.hasNext)
    return new UsageLimitError("The first login is at its usage limit.");
  if (login.name === "fallback")
    return new Error(
      `Both Claude Code logins are at their usage limit, so the run cannot complete. The transcript is in ${where}.`
    );
  return null;
}

/** Runs the attempt on each login in turn until one is not at its limit. */
export async function withFallbackLogin<T>(
  logins: Login[],
  attempt: (login: Login) => Promise<T>,
  onFallback: () => void
): Promise<T> {
  for (const login of logins) {
    try {
      return await attempt(login);
    } catch (error) {
      if (!(error instanceof UsageLimitError) || !login.hasNext) throw error;
      onFallback();
    }
  }
  throw new Error("unreachable: no login");
}
