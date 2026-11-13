import { readFile } from "node:fs/promises";

import { stockBrowser } from "../playwright/infrastructure";
import { serveWindow, toolbarBridge } from "../server/infrastructure";
import { startRecorderOn, type Recorder } from "./recorder";

export type RecorderOptions = {
  /** The project's folder. Playwright is resolved from here; the engine
   * brings none of its own. A recording is saved in its `.ayme/recordings`. */
  readonly projectDir: string;
  /** Launch a browser on a URL, or attach to one that is running. */
  readonly browser:
    | {
        readonly launch: {
          readonly url: string;
          /** Without a visible window. Off unless set. */
          readonly headless?: boolean;
          /** Also opens the browser's DevTools protocol on this local port,
           * so that a test can act in the recorded browser over a
           * connection of its own. */
          readonly debugPort?: number;
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

/** The toolbar's script and its way to the recorder, when it is asked for. */
async function toolbarFor(options: RecorderOptions) {
  if (!options.toolbar) return undefined;
  // Read before anything opens: a CLI built without it fails at once.
  const script = await readFile(options.toolbar.script, "utf8");
  return { script, bridge: toolbarBridge() };
}

/**
 * Starts a recorder. Only starting can fail: it rejects with a
 * `RecorderStartError` that carries a reason. Everything after is told
 * through the handle.
 */
export async function startRecorder(
  options: RecorderOptions
): Promise<Recorder> {
  const { projectDir } = options;
  const toolbar = await toolbarFor(options);
  const window = options.window
    ? await serveWindow(options.window.folder)
    : undefined;
  const shown = toolbar && {
    script: toolbar.script,
    answer: toolbar.bridge.answer,
  };
  if ("attach" in options.browser)
    return startRecorderOn(
      stockBrowser({
        projectDir,
        cdpEndpoint: options.browser.attach.cdpEndpoint,
        toolbar: shown,
      }),
      { projectDir, window, toolbar: toolbar?.bridge }
    );
  const { url, headless = false, debugPort } = options.browser.launch;
  return startRecorderOn(
    stockBrowser({
      projectDir,
      url,
      headless,
      debugPort,
      windowUrl: window?.url,
      toolbar: shown,
    }),
    { projectDir, window, toolbar: toolbar?.bridge }
  );
}
