import { PROBE_PATH, SERVER_IDENTITY } from "../domain/admission";
import { SERVER_HOST } from "../domain/pairing";

/** How long a probe waits for a port to answer. */
const PROBE_TIMEOUT_MS = 2000;

/**
 * The addresses of the Ayme MCP servers that answer a probe on `ports` of
 * the loopback interface, in port order, probed with `WebSocketClass`, the
 * global WebSocket unless given. A busy server answers a page's
 * probe as busy, so a page's scan does not count it (see `probeAnswer`).
 */
export async function findServers(
  ports: Readonly<{ first: number; last: number }>,
  WebSocketClass: typeof WebSocket = WebSocket
): Promise<string[]> {
  const addresses: string[] = [];
  for (let port = ports.first; port <= ports.last; port += 1)
    addresses.push(`ws://${SERVER_HOST}:${port}`);
  const found = await Promise.all(
    addresses.map((address) => isAymeServer(address, WebSocketClass))
  );
  return addresses.filter((_address, index) => found[index]);
}

/** Whether an Ayme MCP server answers the probe at `address`. */
function isAymeServer(
  address: string,
  WebSocketClass: typeof WebSocket
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocketClass(address + PROBE_PATH);
    const timeout = setTimeout(() => {
      socket.close();
      resolve(false);
    }, PROBE_TIMEOUT_MS);
    // The ws package, an App Process's WebSocket before Node 22, throws an
    // error event no one listens to; the close event that follows answers.
    socket.addEventListener("error", () => {});
    socket.addEventListener("close", ({ code, reason }) => {
      clearTimeout(timeout);
      resolve(
        code === SERVER_IDENTITY.code && reason === SERVER_IDENTITY.reason
      );
    });
  });
}
