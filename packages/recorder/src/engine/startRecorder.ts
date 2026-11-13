import { stockBrowser } from "../playwright/infrastructure";
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
};

/**
 * Starts a recorder. Only starting can fail: it rejects with a
 * `RecorderStartError` that carries a reason. Everything after is told
 * through the handle.
 */
export function startRecorder(options: RecorderOptions): Promise<Recorder> {
  const { url, headless = false, debugPort } = options.browser.launch;
  return startRecorderOn(
    stockBrowser({ projectDir: options.projectDir, url, headless, debugPort }),
    { projectDir: options.projectDir }
  );
}
