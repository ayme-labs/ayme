import { stockBrowser } from "../playwright/infrastructure";
import { serveWindow } from "../server/infrastructure";
import { startRecorderOn, type Recorder } from "./recorder";

export type RecorderOptions = {
  /** The project's folder. Playwright is resolved from here; the engine
   * brings none of its own. A recording is saved in its `.ayme/recordings`. */
  readonly projectDir: string;
  /** Launch a browser on a URL. */
  readonly browser: {
    readonly launch: {
      readonly url: string;
      /** Without a visible window. Off unless set. */
      readonly headless?: boolean;
      /** Also opens the browser's DevTools protocol on this local port, so
       * that a test can act in the recorded browser over a connection of its
       * own. */
      readonly debugPort?: number;
    };
  };
  /** Serve the recorder window, whose built files are in `folder`. The
   * engine knows nothing else of the window: the caller says where it is. */
  readonly window?: { readonly folder: string };
};

/**
 * Starts a recorder. Only starting can fail: it rejects with a
 * `RecorderStartError` that carries a reason. Everything after is told
 * through the handle.
 */
export async function startRecorder(
  options: RecorderOptions
): Promise<Recorder> {
  const { url, headless = false, debugPort } = options.browser.launch;
  const window = options.window
    ? await serveWindow(options.window.folder)
    : undefined;
  return startRecorderOn(
    stockBrowser({ projectDir: options.projectDir, url, headless, debugPort }),
    { projectDir: options.projectDir, window }
  );
}
