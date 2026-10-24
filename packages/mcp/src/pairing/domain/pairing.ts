/**
 * What pairs a page with one Ayme MCP server: the server's WebSocket address
 * on the loopback interface, and the token the server accepts.
 */
export type Pairing = Readonly<{
  /** `ws://127.0.0.1:<port>`, with no path. */
  address: string;
  /**
   * The server's token. Empty for a tab that auto-paired: the server
   * accepts it by its localhost origin instead.
   */
  token: string;
}>;

/** The ports an Ayme MCP server listens on: the first free one. */
export const SERVER_PORTS = Object.freeze({ first: 9350, last: 9365 });

/** The loopback host the server listens on. */
export const SERVER_HOST = "127.0.0.1";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const FRAGMENT = /^#ayme=(.+)$/;

/** The URL the page client opens: the address with the token as its path. */
export function socketUrl({ address, token }: Pairing): string {
  return `${address}/${token}`;
}

/**
 * The connect link: `url` with `#ayme=<socket url>` as its fragment. Throws
 * when `url` is not an http(s) URL.
 */
export function connectLink(url: string, pairing: Pairing): string {
  const link = URL.canParse(url) ? new URL(url) : undefined;
  if (link?.protocol !== "http:" && link?.protocol !== "https:")
    throw new Error(
      `Expected an http or https URL, got ${JSON.stringify(url)}.`
    );
  link.hash = `ayme=${socketUrl(pairing)}`;
  return link.href;
}

/**
 * The pairing a connect link's fragment carries, or `undefined` when the
 * fragment is not one. Only a loopback WebSocket address pairs, so a link
 * can never point the page at another machine.
 */
export function pairingFromFragment(hash: string): Pairing | undefined {
  const value = FRAGMENT.exec(hash)?.[1];
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const token = url.pathname.slice(1);
  if (
    url.protocol !== "ws:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    !/^[\w-]+$/.test(token)
  )
    return undefined;
  return { address: `ws://${url.host}`, token };
}

/**
 * Why a tab that turned the Agent Connection on is not connected to an
 * agent's server:
 * - `connecting`: it has a pairing and its channel is opening;
 * - `reconnecting`: it lost the server it paired with a moment ago, and is
 *   trying again;
 * - `no-answer`: the server it paired with stopped answering, and it keeps
 *   trying;
 * - `no-server`: its last look found no Ayme MCP server;
 * - `several-servers`: its last look found more than one, so it would not
 *   pick one;
 * - `other-tab`: the server works with another tab, which took it over or
 *   had it first;
 * - `not-local`: the page is not on localhost, so it never looks for a
 *   server by itself.
 */
export type NotConnectedReason =
  | "connecting"
  | "reconnecting"
  | "no-answer"
  | "no-server"
  | "several-servers"
  | "other-tab"
  | "not-local";

/**
 * A way the page client learns a pairing, such as a connect link. It calls
 * `onPairing` with each pairing it finds and returns what stops it.
 * `lookNow: false`, as after a server refused the tab's pairing, asks it to
 * wait for the tab's next focus before it looks for a server. A source that
 * looks for a server and finds none to pair with tells `onUnpaired` why.
 */
export type PairingSource = (
  onPairing: (pairing: Pairing) => void,
  options?: {
    lookNow?: boolean;
    onUnpaired?: (reason: NotConnectedReason) => void;
  }
) => () => void;
