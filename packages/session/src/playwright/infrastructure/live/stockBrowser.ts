import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, projectPlaywright } from "@ayme-dev/browser";
import { Effect, Layer } from "effect";
import type { Browser } from "playwright-core";

import { SessionBrowser } from "../../../session/application";
import { SessionStartError } from "../../../session/domain";
import type { NodePageObjects } from "../../../page-objects/infrastructure";
import { sessionStartError } from "../startErrors";
import { hostTab } from "./tabHost";

const startFailed = (what: string) => (cause: unknown) =>
  new SessionStartError(
    `${what} ${cause instanceof Error ? cause.message : String(cause)}`
  );

/** A folder of its own for the browser's profile, removed with it. */
const profileFolder = Effect.acquireRelease(
  Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "ayme-session-")),
    catch: startFailed("The browser's profile folder could not be made."),
  }),
  (folder) =>
    Effect.promise(() =>
      rm(folder, { recursive: true, force: true }).catch(() => {})
    )
);

/** The address of the browser's DevTools protocol, on the port Chromium
 * picked and wrote into its profile. */
const addressOf = (profile: string) =>
  Effect.tryPromise({
    try: () => readFile(join(profile, "DevToolsActivePort"), "utf8"),
    catch: startFailed("Chromium opened, but its address could not be read."),
  }).pipe(Effect.map((file) => `http://127.0.0.1:${file.split("\n")[0]}`));

const goneFrom = (playwrightBrowser: Browser) =>
  Effect.callback<void>((resume) => {
    playwrightBrowser.once("disconnected", () => resume(Effect.void));
    if (!playwrightBrowser.isConnected()) resume(Effect.void);
  });

/** The browser of a Session, on the Playwright of the project in
 * `projectDir`. */
export const stockBrowser = (projectDir: string): Layer.Layer<SessionBrowser> =>
  Layer.succeed(SessionBrowser, {
    get: ({ open }) =>
      Effect.gen(function* () {
        const found = yield* projectPlaywright(projectDir).pipe(
          Effect.mapError(sessionStartError)
        );
        const profile = yield* profileFolder;
        // Port 0: Chromium picks a free one, so no other process can take
        // it in between.
        const { playwrightBrowser } = yield* browser(found, {
          open: { headed: open.headed, debugPort: 0, profile },
        }).pipe(Effect.mapError(sessionStartError));
        const context = playwrightBrowser.contexts()[0]!;
        // A dialog nobody listens for is dismissed by Playwright at once:
        // this listener leaves every dialog to the developer's browser
        // automation.
        context.on("dialog", () => {});
        // The Tab the browser opened on.
        const page = context.pages()[0]!;
        const { url } = open;
        // Once the navigation commits: a dialog the page opens while it
        // loads is the browser automation's to answer, which it can only do
        // once the start is answered with the address. Playwright's own
        // navigation timeout bounds a server that never answers.
        if (url !== undefined)
          yield* Effect.tryPromise({
            try: () => page.goto(url, { waitUntil: "commit" }),
            catch: startFailed(`Chromium opened, but ${url} did not load.`),
          });
        return {
          address: yield* addressOf(profile),
          gone: goneFrom(playwrightBrowser),
          // The Session hands the Tab the Page Objects the project's build
          // gave.
          host: (pageObjects) => hostTab(page, pageObjects as NodePageObjects),
        };
      }),
  });
