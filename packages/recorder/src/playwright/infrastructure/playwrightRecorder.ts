import type { BrowserContext, Page } from "playwright-core";

// Playwright's own recorder, started on a context without its window: a
// private part of Playwright (ADR-0052). Where the supported versions differ
// in reaching it, this module bridges them, and nothing else does.

/** What Playwright's recorder says of one action. */
export type PlaywrightAction = {
  readonly name: string;
  readonly selector?: string;
  /** The target in `ariaSnapshot`, the recorder's own picture of the page. */
  readonly ref?: string | null;
  readonly ariaSnapshot?: string;
  readonly signals?: unknown;
} & Readonly<Record<string, unknown>>;

/** What a report says of its input besides its name and its element: the
 * button, the modifiers, the text and so on. Its signals are not read yet. */
export function valuesOf(action: PlaywrightAction): Record<string, unknown> {
  const { name, selector, ref, ariaSnapshot, signals, ...values } = action;
  void [name, selector, ref, ariaSnapshot, signals];
  return values;
}

/** Who hears of what Playwright's recorder reports. */
export type ActionSink = {
  actionAdded(page: Page, action: PlaywrightAction): void;
  /** Playwright revised the action it reported last on the page, as it does
   * with each key typed into the same field. */
  actionUpdated(page: Page, action: PlaywrightAction): void;
  /** A report that could not be decoded (`action` undefined), or that one
   * of the two above threw on: told instead, since Playwright calls them
   * where nothing catches a throw, which would end the process with nothing
   * saved. */
  unread(
    page: Page,
    unread: {
      readonly action: PlaywrightAction | undefined;
      readonly revision: boolean;
      readonly cause: unknown;
    }
  ): void;
};

/** The context as each version's recorder is reached on it. */
type RecorderContext = {
  /** 1.64 and later. */
  _startRecording?(options: { language: string }, sink: RawSink): Promise<void>;
  /** Up to 1.63. */
  _enableRecorder?(
    options: { mode: "recording"; recorderMode: "api"; language: string },
    sink: RawSink
  ): Promise<void>;
};
type RawSink = {
  actionAdded(page: Page, action: unknown): void;
  actionUpdated(page: Page, action: unknown): void;
  signalAdded(page: Page, signal: unknown): void;
};

/** 1.62 wraps each action as `{ pageGuid, action, startTime }`; later
 * versions hand it over bare. */
function actionOf(reported: unknown): PlaywrightAction {
  const wrapped = (reported as { action?: PlaywrightAction }).action;
  const action =
    typeof wrapped?.name === "string"
      ? wrapped
      : (reported as PlaywrightAction);
  if (typeof action.name !== "string")
    throw new Error("Playwright's report names no action.");
  return action;
}

/** Decodes a report and hands it to the sink; one that cannot be decoded,
 * or that the sink throws on, is told as unread. */
function handOver(
  sink: ActionSink,
  page: Page,
  reported: unknown,
  revision: boolean
) {
  let action: PlaywrightAction | undefined;
  try {
    action = actionOf(reported);
    if (revision) sink.actionUpdated(page, action);
    else sink.actionAdded(page, action);
  } catch (cause) {
    try {
      sink.unread(page, { action, revision, cause });
    } catch {
      // Nothing is left to tell it to: a throw would reach Playwright.
    }
  }
}

/**
 * Playwright's recorder on this context, or undefined when this Playwright
 * has none the engine knows how to start. Starting it has Playwright report
 * every action to `sink` from then on.
 */
export function playwrightRecorderOf(
  context: BrowserContext
): ((sink: ActionSink) => Promise<void>) | undefined {
  const reached = context as unknown as RecorderContext;
  const language = "playwright-test";
  const raw = (sink: ActionSink): RawSink => ({
    actionAdded: (page, action) => handOver(sink, page, action, false),
    actionUpdated: (page, action) => handOver(sink, page, action, true),
    // The signals it adds to a report are not read yet.
    signalAdded: () => {},
  });
  if (typeof reached._startRecording === "function")
    return (sink) => reached._startRecording!({ language }, raw(sink));
  if (typeof reached._enableRecorder === "function")
    return (sink) =>
      reached._enableRecorder!(
        { mode: "recording", recorderMode: "api", language },
        raw(sink)
      );
  return undefined;
}
