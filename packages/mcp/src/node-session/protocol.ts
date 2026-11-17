// Spike: what a thin command sends the background process over its local
// socket, and what comes back. One JSON line each way, then the socket closes.
import { createConnection } from "node:net";

export type SessionRequest =
  | { method: "page_objects" }
  | { method: "tools" }
  | { method: "call"; name: string; input: unknown }
  | { method: "stop" };

/** The text a command prints, and whether the request succeeded. */
export type SessionResponse = { ok: boolean; text: string };

/** Sends `request` to the process listening on `socket` and resolves with its answer. */
export function sendRequest(
  socket: string,
  request: SessionRequest
): Promise<SessionResponse> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let received = "";
    connection.setEncoding("utf8");
    connection.on("connect", () =>
      connection.write(`${JSON.stringify(request)}\n`)
    );
    connection.on("data", (chunk: string) => (received += chunk));
    connection.on("error", reject);
    connection.on("end", () => {
      try {
        resolve(JSON.parse(received) as SessionResponse);
      } catch {
        reject(
          new Error("The Ayme process closed the socket without an answer.")
        );
      }
    });
  });
}
