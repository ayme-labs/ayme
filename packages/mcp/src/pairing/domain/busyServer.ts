import { BUSY_SERVER, SERVER_IDENTITY, isLocalProcess } from "./admission";

/**
 * A busy server refuses tokenless pairing: while it works with a tab, paired
 * or away waiting for it to reconnect, only that tab may connect without a
 * token, as when its socket reopens before the server's token reached it.
 * Any other tab needs the server's connect link, so auto-pairing never
 * takes an agent's tab away; with a link, the newest tab wins. An App
 * Process pairs beside the tab, so a busy server never refuses it.
 *
 * `busyWith` is the id of the tab the server works with, if any; `tab` the
 * id of the tab connecting without a token.
 */
export function busyRefuses({
  busyWith,
  tab,
}: {
  busyWith: string | undefined;
  tab: string;
}): boolean {
  return busyWith !== undefined && busyWith !== tab;
}

/**
 * How the server closes an auto-pair probe from `origin`. A busy server
 * does not count for a page's scan, since it would refuse the page (see
 * `busyRefuses`); a local process, such as an App Process, pairs beside
 * the tab, so the server tells it who it is even while busy.
 */
export function probeAnswer({
  busyWith,
  origin,
}: {
  busyWith: string | undefined;
  origin: string | undefined;
}): typeof SERVER_IDENTITY | typeof BUSY_SERVER {
  return busyWith === undefined || isLocalProcess(origin)
    ? SERVER_IDENTITY
    : BUSY_SERVER;
}
