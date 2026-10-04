import { PROBE_PATH, SERVER_IDENTITY, isLocalHost } from "../domain/admission";
import type { Pairing, PairingSource } from "../domain/pairing";
import {
  SERVER_HOST,
  SERVER_PORTS,
  pairingFromFragment,
} from "../domain/pairing";
import {
  PAIRING_STORAGE_KEY,
  serializePairing,
} from "../domain/pairingStorage";

/** How long a probe waits for a port to answer. */
const PROBE_TIMEOUT_MS = 2000;

/**
 * Pairs a page on `localhost` or `127.0.0.1` by itself when the tab has no
 * connect link and no stored pairing: it probes every port of the server's
 * range and pairs only when exactly one Ayme MCP server answers. The tab
 * keeps the pairing in sessionStorage, without a token.
 */
export const autoPairing: PairingSource = (onPairing) => {
  let stopped = false;
  if (isLocalHost(window.location.hostname) && !hasPairing())
    void findOnlyServer().then((address) => {
      if (stopped || !address || hasPairing()) return;
      const pairing: Pairing = { address, token: "" };
      try {
        window.sessionStorage.setItem(
          PAIRING_STORAGE_KEY,
          serializePairing(pairing)
        );
      } catch {
        // Storage may be unavailable; the pairing still holds for this document.
      }
      onPairing(pairing);
    });
  return () => {
    stopped = true;
  };
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
  const addresses: string[] = [];
  for (let port = SERVER_PORTS.first; port <= SERVER_PORTS.last; port += 1)
    addresses.push(`ws://${SERVER_HOST}:${port}`);
  const found = await Promise.all(addresses.map(isAymeServer));
  const servers = addresses.filter((_address, index) => found[index]);
  return servers.length === 1 ? servers[0] : undefined;
}

/** Whether an Ayme MCP server answers the probe at `address`. */
function isAymeServer(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(address + PROBE_PATH);
    const timeout = setTimeout(() => {
      socket.close();
      resolve(false);
    }, PROBE_TIMEOUT_MS);
    socket.addEventListener("close", ({ code, reason }) => {
      clearTimeout(timeout);
      resolve(
        code === SERVER_IDENTITY.code && reason === SERVER_IDENTITY.reason
      );
    });
  });
}
