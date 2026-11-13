import { stockBrowser } from "../playwright/infrastructure";
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
};

/**
 * Starts a recorder. Only starting can fail: it rejects with a
 * `RecorderStartError` that carries a reason. Everything after is told
 * through the handle.
 */
export function startRecorder(options: RecorderOptions): Promise<Recorder> {
  const { projectDir } = options;
  if ("attach" in options.browser)
    return startRecorderOn(
      stockBrowser({
        projectDir,
        cdpEndpoint: options.browser.attach.cdpEndpoint,
      }),
      { projectDir }
    );
  const { url, headless = false, debugPort } = options.browser.launch;
  return startRecorderOn(
    stockBrowser({ projectDir, url, headless, debugPort }),
    { projectDir }
  );
}
