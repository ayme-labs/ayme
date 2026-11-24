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

/** Who hears of what Playwright's recorder reports. */
export type ActionSink = {
  actionAdded(page: Page, action: PlaywrightAction): void;
  /** Playwright revised the action it reported last on the page, as it does
   * with each key typed into the same field. */
  actionUpdated(page: Page, action: PlaywrightAction): void;
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
  return typeof wrapped?.name === "string"
    ? wrapped
    : (reported as PlaywrightAction);
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
    actionAdded: (page, action) => sink.actionAdded(page, actionOf(action)),
    actionUpdated: (page, action) => sink.actionUpdated(page, actionOf(action)),
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
