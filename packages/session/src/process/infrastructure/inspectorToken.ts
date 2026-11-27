// The Session's token, which admits the Inspector an Agent App shows in its
// chat to the socket of the Session's Inspector window (ADR-0072): that
// view's origin is the Agent App's, so only a secret tells it apart. Only
// the commands' private socket hands it out.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** A new token, one per window's server, so it ends with the Session. */
export const newToken = (): string => randomBytes(24).toString("base64url");

/** `url` with `token` in its query, as a socket is reached. */
export function withToken(url: string, token: string): string {
  const withIt = new URL(url);
  withIt.searchParams.set("token", token);
  return withIt.href;
}

/** Whether `request` brings `token` in its URL's `token` parameter. */
export function bringsToken(request: IncomingMessage, token: string): boolean {
  const given = new URL(request.url ?? "/", "http://loopback").searchParams.get(
    "token"
  );
  if (given === null) return false;
  const [a, b] = [Buffer.from(given), Buffer.from(token)];
  return a.length === b.length && timingSafeEqual(a, b);
}
