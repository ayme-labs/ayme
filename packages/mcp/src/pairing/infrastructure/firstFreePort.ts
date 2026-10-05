import type { Server } from "node:http";

import { SERVER_HOST, SERVER_PORTS } from "../domain/pairing";

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
      await listen(server, port);
      return port;
    } catch (error) {
      if (!inUse(error)) throw error;
    }
  }
  throw new Error(
    `No free port for the Ayme MCP server between ${ports.first} and ${ports.last}.`
  );
}

/**
 * Starts `server` on `port` of the loopback interface, and only there, and
 * returns that port. Throws when the port is taken.
 */
export async function listenOnPort(
  server: Server,
  port: number
): Promise<number> {
  try {
    await listen(server, port);
    return port;
  } catch (error) {
    if (!inUse(error)) throw error;
    throw new Error(
      `Port ${port} is in use. Start the Ayme MCP server with another --port, or without --port to take a free one from ${SERVER_PORTS.first} to ${SERVER_PORTS.last}.`,
      { cause: error }
    );
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, SERVER_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function inUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}
