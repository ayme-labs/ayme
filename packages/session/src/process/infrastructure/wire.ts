// What a command sends a Session's process over its local socket, and what
// comes back: one JSON line each way, then the socket closes.
import { createConnection, createServer, type Server } from "node:net";

import {
  unknownRequest,
  type SessionAnswer,
  type SessionRequest,
} from "../../session/domain";

/** A request of the Session, or the one the command that started the
 * Session sends for the answer to its start. */
export type WireRequest = SessionRequest | { readonly started: object };

/** The request a line holds, if it holds one: an object, whose kind the
 * Session checks. */
function requestIn(line: string): WireRequest | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as WireRequest)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Listens on `socket`, answering each request with `answer`. */
export function listen(
  socket: string,
  answer: (request: WireRequest) => Promise<SessionAnswer>
): Promise<Server> {
  const server = createServer((connection) => {
    let received = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      received += chunk;
      const end = received.indexOf("\n");
      if (end === -1) return;
      const request = requestIn(received.slice(0, end));
      void (request ? answer(request) : Promise.resolve(unknownRequest)).then(
        (answered) => connection.end(`${JSON.stringify(answered)}\n`)
      );
    });
    // A command that went away before its answer has nobody to tell.
    connection.on("error", () => {});
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => resolve(server));
  });
}

/** Sends `request` to the process listening on `socket` and resolves with
 * its answer. */
export function send(
  socket: string,
  request: WireRequest
): Promise<SessionAnswer> {
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
        resolve(JSON.parse(received) as SessionAnswer);
      } catch {
        reject(new Error("it closed the connection without an answer"));
      }
    });
  });
}
