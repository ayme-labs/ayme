import { isLocalHost } from "../domain/admission";
import type { NotConnectedReason, PairingSource } from "../domain/pairing";
import { SERVER_PORTS, pairingFromFragment } from "../domain/pairing";
import { PAIRING_STORAGE_KEY } from "../domain/pairingStorage";
import { scanServers } from "./serverScan";

/**
 * Pairs a page on `localhost` or `127.0.0.1` by itself when the tab has no
 * connect link and no stored pairing: it probes every port of the server's
 * range and pairs only when exactly one Ayme MCP server answers. It pairs
 * without a token; the server then hands the page its token, which the
 * tab keeps like a connect link's. Until the tab pairs, it scans again
 * each time the tab gains focus or becomes visible, one scan at a time, so
 * a tab opened before its agent's server started still finds it. With
 * `lookNow: false` it scans only from the tab's next focus. It tells
 * `onUnpaired` why each scan did not pair, and that a page off localhost
 * never scans.
 */
export const autoPairing: PairingSource = (
  onPairing,
  { lookNow = true, onUnpaired } = {}
) => {
  if (hasPairing()) return () => {};
  if (!isLocalHost(window.location.hostname)) {
    onUnpaired?.("not-local");
    return () => {};
  }
  let stopped = false;
  let scanning = false;
  const scan = () => {
    if (stopped || scanning) return;
    if (hasPairing()) return stop();
    scanning = true;
    void scanServers(SERVER_PORTS).then(({ servers, busy }) => {
      scanning = false;
      if (stopped) return;
      if (hasPairing()) return stop();
      if (servers.length !== 1) return onUnpaired?.(unpaired(servers, busy));
      stop();
      onPairing({ address: servers[0]!, token: "" });
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

/** Why a scan that found `servers` free and `busy` busy did not pair. */
function unpaired(
  servers: readonly string[],
  busy: number
): NotConnectedReason {
  if (servers.length !== 0) return "several-servers";
  return busy > 0 ? "other-tab" : "no-server";
}
