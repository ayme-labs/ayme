import { createConnection, createServer, type Socket } from "node:net";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";

import type { SessionAnswer } from "../../session/domain";
import { listen, send } from "./wire";

/** A socket path in a folder of the test's own. */
function socketPath(): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "ayme-wire-")));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "s.sock");
}

/** A process on `socket` that does `onConnection` with each connection. */
async function peer(socket: string, onConnection: (c: Socket) => void) {
  const server = createServer(onConnection);
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  onTestFinished(
    () => new Promise<void>((resolve) => server.close(() => resolve()))
  );
  return server;
}

const answered: SessionAnswer = { ok: true, text: "Done." };

it("a command reads its answer at the end of its line, though the other side keeps the connection open", async () => {
  const socket = socketPath();
  const open: Socket[] = [];
  await peer(socket, (connection) => {
    open.push(connection);
    connection.once("data", () =>
      connection.write(`${JSON.stringify(answered)}\n`)
    );
  });
  onTestFinished(() => open.forEach((connection) => connection.destroy()));

  expect(await send(socket, { stop: {} })).toEqual(answered);
});

it("a command whose connection closes without an answer is told so", async () => {
  const socket = socketPath();
  await peer(socket, (connection) =>
    connection.once("data", () => connection.destroy())
  );

  await expect(send(socket, { stop: {} })).rejects.toThrow(
    "it closed the connection without an answer"
  );
});

it("a connection carries one request, however its bytes arrive", async () => {
  const socket = socketPath();
  let answerNow = () => {};
  const answer = vi.fn(
    () =>
      new Promise<SessionAnswer>(
        (resolve) => (answerNow = () => resolve(answered))
      )
  );
  const listening = await listen(socket, answer);
  onTestFinished(() => listening.close());

  const connection = createConnection(socket);
  connection.on("error", () => {});
  connection.resume();
  await new Promise((resolve) => connection.once("connect", resolve));
  connection.write('{"stop":');
  // Apart, so that the line arrives in pieces.
  await new Promise((resolve) => setTimeout(resolve, 20));
  connection.write("{}}\n");
  await new Promise((resolve) => setTimeout(resolve, 20));
  connection.write('{"stop":{}}\n');
  await new Promise((resolve) => setTimeout(resolve, 20));
  answerNow();
  await new Promise((resolve) => connection.once("close", resolve));

  expect(answer).toHaveBeenCalledTimes(1);
  expect(answer).toHaveBeenCalledWith({ stop: {} });
});

it("a connection's request is its first line, also when more arrives with it", async () => {
  const socket = socketPath();
  const answer = vi.fn(() => Promise.resolve(answered));
  const listening = await listen(socket, answer);
  onTestFinished(() => listening.close());

  const connection = createConnection(socket);
  connection.on("error", () => {});
  let told = "";
  connection.on("data", (data) => (told += String(data)));
  await new Promise((resolve) => connection.once("connect", resolve));
  connection.write('{"stop":{}}\n{"tools":{}}\n');
  await new Promise((resolve) => connection.once("close", resolve));

  expect(answer.mock.calls).toEqual([[{ stop: {} }]]);
  expect(told).toBe(`${JSON.stringify(answered)}\n`);
});

it("closing the socket closes the connections that never sent a request", async () => {
  const socket = socketPath();
  const listening = await listen(socket, () => Promise.resolve(answered));
  const idle = createConnection(socket);
  await new Promise((resolve) => idle.once("connect", resolve));
  const closed = new Promise((resolve) => idle.once("close", resolve));

  await listening.close();

  await closed;
});
