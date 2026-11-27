import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";

import { scriptedBrowser } from "../../../testing";
import { serveSession } from "./background";
import { inspectSession } from "./inspect";
import {
  claimRecord,
  privateFolder,
  releaseRecord,
  thisProcess,
  type SessionPlace,
} from "./record";

// `ayme inspect` as the command runs it: it asks the folder's Session where
// its Inspector window is, and opens it in the person's default browser.

const place: SessionPlace = { projectDir: "", name: "shop" };
beforeEach(() => {
  const made = realpathSync(mkdtempSync(join(tmpdir(), "ayme-inspect-")));
  onTestFinished(() => rmSync(made, { recursive: true, force: true }));
  vi.stubEnv("AYME_CACHE_DIR", join(made, "cache"));
  Object.assign(place, { projectDir: made });
});

/** Claims the folder's Session named shop for this process and serves it,
 * with its window, until the test ends. */
async function serveShop() {
  const { folder, socket } = privateFolder();
  const claim = claimRecord(place, { ...thisProcess(), socket });
  if (!("generation" in claim)) throw new Error("the folder has a Session");
  const scope = Effect.runSync(Scope.make());
  onTestFinished(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    releaseRecord(place, claim.generation);
    rmSync(folder, { recursive: true, force: true });
  });
  const { layer } = scriptedBrowser();
  await Effect.runPromise(
    serveSession({
      socket,
      request: { open: { headed: false } },
      name: "shop",
      inspectorScript: join(place.projectDir, "external.mjs"),
    }).pipe(Effect.provide(layer), Scope.provide(scope))
  );
}

const WINDOW = /^http:\/\/127\.0\.0\.1:\d+\/inspector#token=[\w-]+$/;
const WINDOW_IN_TEXT = /http:\/\/127\.0\.0\.1:\d+\/inspector#token=[\w-]+/;

it("asks the person's default browser to open the Session's Inspector window, and says where it is", async () => {
  await serveShop();
  const opened: { command: string; args: readonly string[] }[] = [];

  const answer = await inspectSession(place, {}, async (opener) => {
    opened.push(opener);
    return undefined;
  });

  const { address } = answer.ok
    ? (answer.data as { address: string })
    : { address: "" };
  expect(address).toMatch(WINDOW);
  expect(answer).toEqual({
    ok: true,
    text: `ayme asked your browser to open the Inspector of the Session shop at ${address}.`,
    data: { address },
  });
  expect(opened).toHaveLength(1);
  expect(opened[0]!.args.at(-1)).toBe(address);
});

it("only says where the window is when BROWSER is none", async () => {
  await serveShop();
  const open = vi.fn();

  const answer = await inspectSession(place, { BROWSER: "none" }, open);

  expect(answer).toMatchObject({
    ok: true,
    text: expect.stringMatching(
      /^The Inspector of the Session shop is at http:\/\/127\.0\.0\.1:\d+\/inspector#token=[\w-]+\.$/
    ),
  });
  expect(open).not.toHaveBeenCalled();
});

it("fails, and says where the window is and why no browser opened it, when the opener could not", async () => {
  await serveShop();

  const answer = await inspectSession(
    place,
    {},
    async () => "spawn xdg-open ENOENT"
  );

  expect(answer).toMatchObject({
    ok: false,
    text: expect.stringMatching(
      /^The Inspector of the Session shop is at http:\/\/127\.0\.0\.1:\d+\/inspector#token=[\w-]+\. ayme could not open it in a browser: spawn xdg-open ENOENT\. Open the address in a browser outside the Session's\.$/
    ),
  });
});

it.each([
  ["does not exist", "/no/such/browser", "ENOENT"],
  ["exits with a failure", "false", "false exited with code 1"],
])(
  "fails, and still says where the window is, when the program BROWSER names %s",
  async (_, BROWSER, why) => {
    await serveShop();

    const answer = await inspectSession(place, { BROWSER });

    expect(answer.ok).toBe(false);
    expect(answer.text).toMatch(WINDOW_IN_TEXT);
    expect(answer.text).toContain(why);
  }
);

it("opens nothing when the folder has no Session of that name, and says so", async () => {
  const open = vi.fn();

  const answer = await inspectSession(place, {}, open);

  expect(answer.ok).toBe(false);
  expect(open).not.toHaveBeenCalled();
});
