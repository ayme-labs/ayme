/**
 * A busy server refuses tokenless pairing: while it works with a tab, paired
 * or away waiting for it to reconnect, only that tab may connect without a
 * token, as when an auto-paired tab reloads or navigates. Any other tab
 * needs the server's connect link, so auto-pairing never takes an agent's
 * tab away; with a link, the newest tab wins.
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
