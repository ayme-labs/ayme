// What a command sends a Session's process over its local socket, and what
// comes back: one JSON line each way on a connection of its own, then the
// connection closes. Neither side limits how long an answer takes, since a
// request may start a Run, which has no time limit.
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";

import {
  unanswerable,
  unknownRequest,
  type SessionAnswer,
  type SessionRequest,
} from "../../session/domain";

/** The value a line holds, if it holds an object. */
function objectIn(line: string): object | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Calls `onLine` with the first line `connection` receives, once. */
function firstLine(connection: Socket, onLine: (line: string) => void): void {
  let received = "";
  connection.setEncoding("utf8");
  const onData = (chunk: string) => {
    received += chunk;
    const end = received.indexOf("\n");
    if (end === -1) return;
    connection.off("data", onData);
    connection.pause();
    onLine(received.slice(0, end));
  };
  connection.on("data", onData);
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The line that carries `answering`'s answer: why there is none when it
 * cannot be made or written as JSON, so the command is answered anyway
 * (rule 1). */
async function answerLine(answering: Promise<SessionAnswer>): Promise<string> {
  try {
    return JSON.stringify(await answering);
  } catch (error) {
    return JSON.stringify(unanswerable(messageOf(error)));
  }
}

/** A socket a Session's process listens on. */
export interface Listening {
  /** Stops listening, closes every connection that is not waiting for an
   * answer, and resolves once those that are have theirs. */
  readonly close: () => Promise<void>;
}

/** Listens on `socket`, answering the one request of each connection with
 * `answer`, whose kind the Session checks. */
export function listen(
  socket: string,
  answer: (request: SessionRequest) => Promise<SessionAnswer>
): Promise<Listening> {
  // The connections that have not sent their request yet.
  const idle = new Set<Socket>();
  let closing = false;
  const server: Server = createServer((connection) => {
    // A command that went away before its answer has nobody to tell.
    connection.on("error", () => {});
    if (closing) return void connection.destroy();
    idle.add(connection);
    connection.on("close", () => idle.delete(connection));
    firstLine(connection, (line) => {
      idle.delete(connection);
      const request = objectIn(line) as SessionRequest | undefined;
      void answerLine(
        request ? answer(request) : Promise.resolve(unknownRequest)
      ).then((line) => connection.end(`${line}\n`, () => connection.destroy()));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () =>
      resolve({
        close: () =>
          new Promise((closed) => {
            closing = true;
            server.close(() => closed());
            for (const connection of idle) connection.destroy();
          }),
      })
    );
  });
}

/** Sends `request` to the process listening on `socket` and resolves with
 * its answer. It rejects with the connection's error, whose `code` tells a
 * socket nobody listens on yet. */
export function send(
  socket: string,
  request: SessionRequest
): Promise<SessionAnswer> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    connection.on("connect", () =>
      connection.write(`${JSON.stringify(request)}\n`)
    );
    firstLine(connection, (line) => {
      connection.destroy();
      const answer = objectIn(line);
      if (answer) resolve(answer as SessionAnswer);
      else reject(new Error("it answered with something that is no answer"));
    });
    connection.on("error", reject);
    // Once answered, settling again changes nothing.
    connection.on("close", () =>
      reject(new Error("it closed the connection without an answer"))
    );
  });
}
