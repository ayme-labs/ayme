/**
 * How the server answers a WebSocket connection from a page or an App
 * Process:
 * - `token`: it pairs by the server's token, from its connect link;
 * - `tokenless`: it pairs without a token, by auto-pairing; the server
 *   still refuses a page when it is busy with another tab (see
 *   `busyRefuses`);
 * - `unknownPairing`: a page on localhost, or an App Process, presents a
 *   token that is not this server's, as when another server took the port
 *   of the one it paired with; the server tells it so it forgets that
 *   pairing;
 * - `probe`: an auto-pair scan asks whether this is an Ayme MCP server; the
 *   server answers by closing with {@link SERVER_IDENTITY} (see
 *   `probeAnswer`);
 * - `refused`: anything else.
 */
export type Admission =
  "token" | "tokenless" | "unknownPairing" | "probe" | "refused";

/** The path a page connects to for auto-pairing, without a token. */
export const AUTO_PAIR_PATH = "/";

/** The path the auto-pair scan probes on each port of the server's range. */
export const PROBE_PATH = "/probe";

/** How the server closes a probe, which tells the page it is one. */
export const SERVER_IDENTITY = Object.freeze({
  code: 4350,
  reason: "ayme-mcp",
});

/**
 * How a busy server closes a probe: it is an Ayme MCP server, but one a
 * page may not pair with by itself, so the scan does not count it.
 */
export const BUSY_SERVER = Object.freeze({
  code: 4351,
  reason: "ayme-mcp-busy",
});

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Whether `hostname` is one a page auto-pairs from. */
export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

/**
 * Whether `origin`, a WebSocket handshake's `Origin` header, is an http(s)
 * page on `localhost` or `127.0.0.1`, on any port.
 */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    isLocalHost(url.hostname) &&
    url.origin === origin
  );
}

/**
 * Whether a connection whose handshake carries `origin` comes from a local
 * process, such as an App Process: browsers always send `Origin`, and the
 * server listens on loopback only (ADR-0033).
 */
export function isLocalProcess(origin: string | undefined): boolean {
  return origin === undefined;
}

/**
 * The server's answer to a connection on `path` from `origin`. The token's
 * path pairs from any origin. Without a token, only a page on localhost or
 * a local process, which sends no `Origin`, pairs or probes, so another
 * website the developer has open cannot drive the server or learn that it
 * runs.
 */
export function admit({
  path,
  origin,
  token,
}: {
  path: string;
  origin: string | undefined;
  token: string;
}): Admission {
  if (path === `/${token}`) return "token";
  if (!isLocalProcess(origin) && !isLocalOrigin(origin)) return "refused";
  if (path === AUTO_PAIR_PATH) return "tokenless";
  if (path === PROBE_PATH) return "probe";
  if (/^\/[^/]+$/.test(path)) return "unknownPairing";
  return "refused";
}
