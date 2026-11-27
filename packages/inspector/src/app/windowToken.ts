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
 * The socket of the server that served this browser window, with the
 * Session's token that admits it (ADR-0072). `ayme inspect` opens the
 * window with the token in the fragment, which reaches no server: the
 * window keeps it in its tab and takes it out of the address bar and the
 * history entry. A window served without one, by `@ayme-dev/mcp`'s server,
 * connects without it.
 */
export function sessionSocket({
  location,
  history,
  sessionStorage,
}: BrowserWindow): string {
  const given = new URLSearchParams(location.hash.slice(1)).get("token");
  if (given !== null) {
    sessionStorage.setItem(TOKEN_KEY, given);
    history.replaceState(null, "", location.pathname + location.search);
  }
  const token = given ?? sessionStorage.getItem(TOKEN_KEY);
  const socket = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/inspector/ws`;
  return token === null
    ? socket
    : `${socket}?token=${encodeURIComponent(token)}`;
}
