import type { Server } from "node:http";

import { SERVER_HOST } from "../domain/pairing";

/**
 * Starts `server` on the first port of `ports` that is free on the loopback
 * interface, and returns that port. Each port is tried by listening on it,
 * so no other process can take it in between.
 */
export async function listenOnFirstFreePort(
  server: Server,
  ports: Readonly<{ first: number; last: number }>
): Promise<number> {
  for (let port = ports.first; port <= ports.last; port += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, SERVER_HOST, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(
    `No free port for the Ayme MCP server between ${ports.first} and ${ports.last}.`
  );
}
