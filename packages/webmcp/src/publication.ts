import { waitForWebMcpDriver } from "./driver";
import {
  synchronizeWebMcpTools,
  type WebMcpRegistration,
  type WebMcpToolSource,
} from "./synchronize";

/** Where publication stands, as `ayme.webMCP.publicationStatus` shows it. */
export type WebMcpPublicationStatus = Readonly<{
  state: "waiting" | "active" | "unavailable" | "failed";
  message: string;
}>;

export type WebMcpPublicationOptions = {
  /** Prepended to every published tool name; `""` by default. */
  toolNamePrefix?: string;
  /** Ends publication: every tool is withdrawn and no status follows. */
  signal: AbortSignal;
  /** Called with each new status, until `signal` aborts. */
  onStatus(status: WebMcpPublicationStatus): void;
};

export type WebMcpPublication = {
  /**
   * Tries again after publication found no driver or failed; resolves once
   * the attempt ends. A call during an attempt returns that attempt, and a
   * call while publication is active does nothing.
   */
  retry(): Promise<void>;
};

const WAITING: WebMcpPublicationStatus = {
  state: "waiting",
  message: "Waiting for the WebMCP driver.",
};

/** How long an attempt waits for `document.modelContext` to appear. */
const DRIVER_WAIT_MS = 2_000;

/**
 * Publish `tools` through the page's WebMCP driver until `signal` aborts,
 * starting the first attempt now. An attempt waits for the driver, then keeps
 * the driver's tools in sync with the source's; `onStatus` hears where it
 * stands.
 */
export function startWebMcpPublication(
  tools: WebMcpToolSource,
  { toolNamePrefix, signal, onStatus }: WebMcpPublicationOptions
): WebMcpPublication {
  let publication: WebMcpRegistration | undefined;
  let pending: Promise<void> | undefined;

  const report = (status: WebMcpPublicationStatus) => {
    if (!signal.aborted) onStatus(Object.freeze(status));
  };
  const failed = (error: unknown) =>
    report({
      state: "failed",
      message: `WebMCP publication failed: ${error instanceof Error ? error.message : String(error)}`,
    });

  function retry(): Promise<void> {
    if (signal.aborted || publication) return Promise.resolve();
    if (pending) return pending;
    report(WAITING);
    const attempt = (async () => {
      try {
        const driver = await waitForWebMcpDriver(DRIVER_WAIT_MS, signal);
        if (signal.aborted) return;
        if (!driver) {
          report({
            state: "unavailable",
            message: "The WebMCP driver is unavailable.",
          });
          return;
        }
        let attemptFailed = false;
        const registration = await synchronizeWebMcpTools(driver, tools, {
          toolNamePrefix,
          signal,
          onError(error) {
            attemptFailed = true;
            publication = undefined;
            failed(error);
          },
        });
        if (signal.aborted || attemptFailed) {
          registration.dispose();
          return;
        }
        publication = registration;
        report({ state: "active", message: registration.message });
      } catch (error) {
        failed(error);
      }
    })();
    pending = attempt;
    void attempt.then(() => {
      if (pending === attempt) pending = undefined;
    });
    return attempt;
  }

  void retry();
  return { retry };
}
