import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";

import { scriptedBrowser } from "../../../testing";
import { serveSession } from "./background";
import { askSession, openSession } from "./commands";
import { liveRecord } from "./record";
import { send } from "./wire";

const folder = (name: string) =>
  realpathSync(mkdtempSync(join(tmpdir(), `ayme-${name}-`)));

let projectDir: string;
beforeEach(() => {
  vi.stubEnv("AYME_CACHE_DIR", folder("cache"));
  projectDir = folder("project");
});

/** Serves a Session on a scripted browser in this process, as the
 * background process does, until the test ends. */
async function serve() {
  const { layer, browser } = scriptedBrowser();
  const scope = Effect.runSync(Scope.make());
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const served = await Effect.runPromise(
    serveSession({ projectDir, request: { open: { headed: false } } }).pipe(
      Effect.provide(layer),
      Scope.provide(scope),
      Effect.result
    )
  );
  return {
    served,
    browser,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

it("a command in a folder with no Session says so", async () => {
  expect(await askSession(projectDir, { stop: {} })).toEqual({
    ok: false,
    text: `No Session is open in ${projectDir}. Start one with ayme open.`,
  });
});

it("a command reaches the Session of its folder, and once the Session ends its folder has none", async () => {
  const { served, close } = await serve();
  if (served._tag !== "Success") throw served.failure;

  expect(await askSession(projectDir, { stop: {} })).toEqual({
    ok: true,
    text: "The Session ended and its browser was closed.",
  });
  await Effect.runPromise(served.success.ended);
  await close();

  expect(await askSession(projectDir, { stop: {} })).toMatchObject({
    ok: false,
    text: expect.stringContaining("No Session is open"),
  });
});

it("a second Session in a folder that has one is refused", async () => {
  await serve();

  const { served, browser } = await serve();

  expect(served).toMatchObject({
    _tag: "Failure",
    failure: {
      message: expect.stringContaining(
        `A Session is already open in ${projectDir}`
      ),
    },
  });
  expect(browser.asked).toEqual([]);
});

it("opening a Session in a folder that has one is refused before any process starts", async () => {
  const { served } = await serve();
  if (served._tag !== "Success") throw served.failure;

  const answer = await openSession({
    projectDir,
    request: { open: { headed: false } },
    // A process that would fail otherwise.
    processCommand: ["-e", "console.log('started'); process.exit(9)"],
  });

  expect(answer).toEqual({
    ok: false,
    text: `A Session is already open in ${projectDir}, in process ${process.pid}. End it with ayme close first.`,
  });
});

it("a request the Session does not know is answered so, and the Session goes on", async () => {
  const { served } = await serve();
  if (served._tag !== "Success") throw served.failure;
  const { socket } = liveRecord(projectDir)!;

  for (const request of [{ nope: {} }, "not a request"])
    expect(await send(socket, request as never)).toEqual({
      ok: false,
      text: "ayme does not know this request. Update ayme, or run ayme --help.",
    });

  expect(await askSession(projectDir, { stop: {} })).toMatchObject({
    ok: true,
  });
});
