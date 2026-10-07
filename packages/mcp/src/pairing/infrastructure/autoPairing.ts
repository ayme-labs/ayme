import { isLocalHost } from "../domain/admission";
import type { PairingSource } from "../domain/pairing";
import { SERVER_PORTS, pairingFromFragment } from "../domain/pairing";
import { PAIRING_STORAGE_KEY } from "../domain/pairingStorage";
import { findServers } from "./serverScan";

/**
 * Pairs a page on `localhost` or `127.0.0.1` by itself when the tab has no
 * connect link and no stored pairing: it probes every port of the server's
 * range and pairs only when exactly one Ayme MCP server answers. It pairs
 * without a token; the server then hands the page its token, which the
 * tab keeps like a connect link's. Until the tab pairs, it scans again
 * each time the tab gains focus or becomes visible, one scan at a time, so
 * a tab opened before its agent's server started still finds it. With
 * `lookNow: false` it scans only from the tab's next focus.
 */
export const autoPairing: PairingSource = (
  onPairing,
  { lookNow = true } = {}
) => {
  if (!isLocalHost(window.location.hostname) || hasPairing()) return () => {};
  let stopped = false;
  let scanning = false;
  const scan = () => {
    if (stopped || scanning) return;
    if (hasPairing()) return stop();
    scanning = true;
    void findOnlyServer().then((address) => {
      scanning = false;
      if (stopped) return;
      if (hasPairing()) return stop();
      if (!address) return;
      stop();
      onPairing({ address, token: "" });
    });
  };
  const scanWhenVisible = () => {
    if (document.visibilityState === "visible") scan();
  };
  const stop = () => {
    stopped = true;
    window.removeEventListener("focus", scan);
    document.removeEventListener("visibilitychange", scanWhenVisible);
  };
  window.addEventListener("focus", scan);
  document.addEventListener("visibilitychange", scanWhenVisible);
  if (lookNow) scan();
  return stop;
};

/** Whether the tab has a connect link or a stored pairing. */
function hasPairing(): boolean {
  if (pairingFromFragment(window.location.hash)) return true;
  try {
    return window.sessionStorage.getItem(PAIRING_STORAGE_KEY) !== null;
  } catch {
    // Without storage the tab cannot tell whether a link paired it.
    return true;
  }
}

/** The address of the one server in the range, or `undefined`. */
async function findOnlyServer(): Promise<string | undefined> {
  const servers = await findServers(SERVER_PORTS);
  return servers.length === 1 ? servers[0] : undefined;
}
