// What admits a client to the socket of a Session's Inspector window
// (ADR-0072): the Session's token, which the view an Agent App shows in its
// chat brings and a window is told once admitted, and the one-use code in
// the address `ayme inspect` opens. Only the commands' private socket hands
// out either, since the window's port is open to every user of the machine.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** A new secret: a token, one per window's server, so it ends with the
 * Session, or a code. */
export const newToken = (): string => randomBytes(24).toString("base64url");

/** `url` with `token` in its query, as a socket is reached. */
export function withToken(url: string, token: string): string {
  const withIt = new URL(url);
  withIt.searchParams.set("token", token);
  return withIt.href;
}

/** `page` with `code` in its fragment, which the browser sends to no server
 * and the window's script reads. */
export const withCodeFragment = (page: string, code: string): string =>
  `${page}#code=${code}`;

const same = (given: string, secret: string) => {
  const [a, b] = [Buffer.from(given), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The value of `request`'s URL parameter `key`, if any. */
export const paramOf = (
  request: IncomingMessage,
  key: "token" | "code"
): string | null =>
  new URL(request.url ?? "/", "http://loopback").searchParams.get(key);

/** Whether `request` brings `token` in its URL's `token` parameter. */
export function bringsToken(request: IncomingMessage, token: string): boolean {
  const given = paramOf(request, "token");
  return given !== null && same(given, token);
}

/** The codes made for the openings of one window's server, each taken once
 * and only until `lifetimeMs` after it was made. */
export function openingCodes(lifetimeMs: number) {
  /** Each code not yet taken, with when it runs out. */
  const codes = new Map<string, number>();
  const forget = (now: number) => {
    for (const [code, until] of codes) if (until <= now) codes.delete(code);
  };
  return {
    make(): string {
      const now = Date.now();
      forget(now);
      const code = newToken();
      codes.set(code, now + lifetimeMs);
      return code;
    },
    /** Whether `given` is a code that has not run out, which it takes, so
     * no other client is admitted by it. */
    take(given: string): boolean {
      forget(Date.now());
      for (const code of codes.keys())
        if (same(given, code)) return codes.delete(code);
      return false;
    },
  };
}
