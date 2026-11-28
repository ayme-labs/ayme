import type { BrowserContext, Page } from "playwright-core";
import { expect, it } from "vitest";

import {
  playwrightRecorderOf,
  type PlaywrightAction,
} from "./playwrightRecorder";

// How each supported version starts Playwright's own recorder and hands over
// its reports, on stand-ins for a context: the per-version CI job runs the
// compatibility suite on the real ones, while this package's own Playwright is
// one version only. The calls are those Playwright's private API takes: the
// prototype of pull request #1268 started the recorder so on 1.62 to 1.65.

type Sink = {
  actionAdded(page: Page, action: unknown): void;
  actionUpdated(page: Page, action: unknown): void;
  signalAdded(page: Page, signal: unknown): void;
};

/** A context that starts its recorder by `call`, and what it was given. */
function contextWith(call: "_startRecording" | "_enableRecorder") {
  const started: { options: unknown; sink: Sink }[] = [];
  const context = {
    [call]: async (options: unknown, sink: Sink) => {
      started.push({ options, sink });
    },
  } as unknown as BrowserContext;
  return { context, started };
}

const page = {} as Page;
const click: PlaywrightAction = {
  name: "click",
  selector: 'internal:role=button[name="Add"i]',
  ref: "e3",
  button: "left",
};

/** Starts the recorder found on the context, and what it reports. */
async function start(context: BrowserContext) {
  const added: PlaywrightAction[] = [];
  const updated: PlaywrightAction[] = [];
  await playwrightRecorderOf(context)!({
    actionAdded: (_, action) => added.push(action),
    actionUpdated: (_, action) => updated.push(action),
    unread: () => {},
  });
  return { added, updated };
}

it("starts the recorder of 1.64 and later with the language it writes", async () => {
  const { context, started } = contextWith("_startRecording");

  await start(context);

  expect(started.map(({ options }) => options)).toEqual([
    { language: "playwright-test" },
  ]);
});

it("starts the recorder of 1.63 and earlier in its API mode, recording", async () => {
  const { context, started } = contextWith("_enableRecorder");

  await start(context);

  expect(started.map(({ options }) => options)).toEqual([
    { mode: "recording", recorderMode: "api", language: "playwright-test" },
  ]);
});

it("hands over an action that 1.63 and later report bare as it is", async () => {
  const { context, started } = contextWith("_startRecording");
  const { added, updated } = await start(context);

  started[0]!.sink.actionAdded(page, click);
  started[0]!.sink.actionUpdated(page, { ...click, name: "fill" });

  expect(added).toEqual([click]);
  expect(updated).toEqual([{ ...click, name: "fill" }]);
});

it("unwraps an action that 1.62 reports inside an outer object", async () => {
  const { context, started } = contextWith("_enableRecorder");
  const { added, updated } = await start(context);

  const wrapped = (action: PlaywrightAction) => ({
    pageGuid: "page@1",
    action,
    startTime: 1,
  });
  started[0]!.sink.actionAdded(page, wrapped(click));
  started[0]!.sink.actionUpdated(page, wrapped({ ...click, name: "fill" }));

  expect(added).toEqual([click]);
  expect(updated).toEqual([{ ...click, name: "fill" }]);
});

it("finds no recorder on a context that has neither call", () => {
  expect(playwrightRecorderOf({} as BrowserContext)).toBeUndefined();
});

/** Starts the recorder found on the context with a sink that throws on
 * `throwsOn`, and what it hears, read or not. */
async function startWithUnread(context: BrowserContext, throwsOn?: string) {
  const added: PlaywrightAction[] = [];
  const unread: {
    action: PlaywrightAction | undefined;
    revision: boolean;
    cause: unknown;
  }[] = [];
  await playwrightRecorderOf(context)!({
    actionAdded: (_, action) => {
      if (action.name === throwsOn) throw new Error("It broke.");
      added.push(action);
    },
    actionUpdated: (_, action) => {
      if (action.name === throwsOn) throw new Error("It broke.");
    },
    unread: (_, what) => unread.push(what),
  });
  return { added, unread };
}

it("tells a report it cannot decode as unread, throws nothing at Playwright, and hands over the next report", async () => {
  const { context, started } = contextWith("_startRecording");
  const { added, unread } = await startWithUnread(context);

  expect(() => started[0]!.sink.actionAdded(page, null)).not.toThrow();
  expect(() => started[0]!.sink.actionAdded(page, { name: 5 })).not.toThrow();
  started[0]!.sink.actionAdded(page, click);

  expect(unread.map(({ action, revision }) => ({ action, revision }))).toEqual([
    { action: undefined, revision: false },
    { action: undefined, revision: false },
  ]);
  expect(added).toEqual([click]);
});

it("tells a report the sink throws on as unread, with the action it decoded", async () => {
  const { context, started } = contextWith("_startRecording");
  const { unread } = await startWithUnread(context, "fill");

  expect(() =>
    started[0]!.sink.actionAdded(page, { ...click, name: "fill" })
  ).not.toThrow();
  expect(() =>
    started[0]!.sink.actionUpdated(page, { ...click, name: "fill" })
  ).not.toThrow();

  expect(unread).toEqual([
    {
      action: { ...click, name: "fill" },
      revision: false,
      cause: new Error("It broke."),
    },
    {
      action: { ...click, name: "fill" },
      revision: true,
      cause: new Error("It broke."),
    },
  ]);
});

it("throws nothing at Playwright when telling of a report it could not read breaks too", async () => {
  const { context, started } = contextWith("_startRecording");
  await playwrightRecorderOf(context)!({
    actionAdded: () => {},
    actionUpdated: () => {},
    unread: () => {
      throw new Error("It broke as well.");
    },
  });

  expect(() => started[0]!.sink.actionAdded(page, null)).not.toThrow();
});
