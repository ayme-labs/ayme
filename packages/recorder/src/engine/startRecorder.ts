import { readFile } from "node:fs/promises";

import { stockBrowser } from "../playwright/infrastructure";
import {
  serveWindow,
  toolbarBridge,
  type ToolbarBridge,
} from "../server/infrastructure";
import { startRecorderOn, type Recorder } from "./recorder";

export type RecorderOptions = {
  /** The project's folder. Playwright is resolved from here; the engine
   * brings none of its own. A recording is saved in its `ayme/recordings`. */
  readonly projectDir: string;
  /** Launch a browser on a URL, or attach to one that is running. */
  readonly browser:
    | {
        readonly launch: {
          readonly url: string;
          /** Without a visible window. Off unless set. */
          readonly headless?: boolean;
          /** Open already recording: the page opens blank, Record is
           * applied, and only then does the page go to `url`, so that the
           * recording and its trace hold the first page load. Off unless
           * set. */
          readonly startRecording?: boolean;
          /** Also opens the browser's DevTools protocol on this local port,
           * so that a test can act in the recorded browser over a
           * connection of its own. */
          readonly debugPort?: number;
          /** A storage state file, as Playwright writes it: the recorded
           * page's context starts with its cookies and local storage, as
           * Playwright's codegen `--load-storage` does. One that cannot be
           * read keeps the recorder from starting. */
          readonly loadStorage?: string;
          /** Where the recorded context's storage state is saved when the
           * recorder ends, however it ends, as Playwright's codegen
           * `--save-storage` does: once the recording is over and its
           * trace is stopped, thrown away or given up on. One that cannot
           * be saved is a warning. */
          readonly saveStorage?: string;
        };
      }
    | {
        readonly attach: {
          /** The address of the running Chromium's DevTools protocol on
           * this machine, such as `http://127.0.0.1:9222`. Its one page is
           * recorded as it is, never navigated, and the browser stays open
           * when the recorder ends. */
          readonly cdpEndpoint: string;
        };
      };
  /** Serve the recorder window, whose built files are in `folder`. The
   * engine knows nothing else of the window: the caller says where it is. */
  readonly window?: { readonly folder: string };
  /** Put the in-page toolbar in every recorded page: `script` is the path
   * of its built script. The engine knows nothing else of the toolbar. */
  readonly toolbar?: { readonly script: string };
};

/** The in-page toolbar: its script's text, and its way to the recorder. */
export type ToolbarKit = {
  readonly script: string;
  readonly bridge: ToolbarBridge;
};

/** The toolbar's script and its way to the recorder, when it is asked for. */
export async function toolbarFor(
  options: RecorderOptions
): Promise<ToolbarKit | undefined> {
  if (!options.toolbar) return undefined;
  // Read before anything opens: a CLI built without it fails at once.
  const script = await readFile(options.toolbar.script, "utf8");
  return { script, bridge: toolbarBridge() };
}

/** What the stock adapter is asked for, from the caller's options. */
export function stockOptionsOf(
  options: RecorderOptions,
  windowUrl: string | undefined,
  toolbar: ToolbarKit | undefined
): Parameters<typeof stockBrowser>[0] {
  const { projectDir } = options;
  const shown = toolbar && {
    script: toolbar.script,
    answer: toolbar.bridge.answer,
  };
  if ("attach" in options.browser)
    return {
      projectDir,
      cdpEndpoint: options.browser.attach.cdpEndpoint,
      toolbar: shown,
    };
  const {
    url,
    headless = false,
    debugPort,
    startRecording,
    loadStorage,
    saveStorage,
  } = options.browser.launch;
  return {
    projectDir,
    url,
    headless,
    debugPort,
    ...(startRecording ? { startRecording } : {}),
    loadStorage,
    saveStorage,
    windowUrl,
    toolbar: shown,
  };
}

/**
 * Starts a recorder. Only starting can fail: it rejects with a
 * `RecorderStartError` that carries a reason. Everything after is told
 * through the handle. One asked to start recording is handed out once
 * Record is answered, as if it had been pressed on the blank page: the page
 * goes to its URL then.
 */
export async function startRecorder(
  options: RecorderOptions
): Promise<Recorder> {
  const toolbar = await toolbarFor(options);
  const window = options.window
    ? await serveWindow(options.window.folder)
    : undefined;
  const recorder = await startRecorderOn(
    stockBrowser(stockOptionsOf(options, window?.url, toolbar)),
    { projectDir: options.projectDir, window, toolbar: toolbar?.bridge }
  );
  if ("launch" in options.browser && options.browser.launch.startRecording)
    await recorder.send({ type: "record" });
  return recorder;
}
