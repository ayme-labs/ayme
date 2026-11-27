import { readStored, tabStorage, writeStored } from "../shared/infrastructure";

/** Where the window keeps the Session's token in its tab, so a reload still
 * connects. */
const TOKEN_KEY = "ayme:inspector-token";

/** What the window's socket is read from. */
type BrowserWindow = {
  readonly location: Pick<
    Location,
    "protocol" | "host" | "pathname" | "search" | "hash"
  >;
  readonly history: Pick<History, "replaceState">;
  readonly sessionStorage: Pick<Storage, "getItem" | "setItem">;
};

/**
 * How this browser window reaches the socket of the server that served it
 * (ADR-0072). `ayme inspect` opens the window with a one-use code in the
 * fragment, which reaches no server: the window takes it out of the address
 * bar and connects with it once; the Session then tells it its token, which
 * the window connects again with and keeps in its tab for a reload. Where
 * the browser blocks the tab's storage or it is full, a reload needs
 * `ayme inspect` again. A window served without either, by
 * `@ayme-dev/mcp`'s server, connects without.
 */
export function windowAdmission(browser: BrowserWindow): {
  /** The socket to connect to now. */
  readonly socket: () => string;
  /** Keeps `token`, which the Session told the window once admitted. */
  readonly admitted: (token: string) => void;
} {
  const { location, history } = browser;
  const code = new URLSearchParams(location.hash.slice(1)).get("code");
  if (code !== null)
    history.replaceState(null, "", location.pathname + location.search);
  const storage = tabStorage(browser);
  const kept = code === null ? readStored(storage, TOKEN_KEY) : undefined;
  let token = typeof kept === "string" ? kept : undefined;
  const socket = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/inspector/ws`;
  return {
    socket: () => {
      if (token !== undefined)
        return `${socket}?token=${encodeURIComponent(token)}`;
      return code === null
        ? socket
        : `${socket}?code=${encodeURIComponent(code)}`;
    },
    admitted: (given) => {
      token = given;
      writeStored(storage, TOKEN_KEY, given);
    },
  };
}
