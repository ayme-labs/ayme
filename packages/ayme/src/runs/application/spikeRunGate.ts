// Spike (dialogs): the gate a Node host uses to stop or hold a Page Object
// Action's own Playwright calls while a dialog it opened is open or after
// another tool answered it. The page wrapper in runs/infrastructure reads it.
// Spike (dialogs): while a refusal is set, every call a Page Object makes
// through a wrapped Page, a locator or an input device throws it instead of
// reaching Playwright. While held, every call but the synchronous ones below
// waits until the hold is released to allow or refuse. The session allows
// again when the Run's action ends.
let refusal: string | undefined;
let held: Promise<void> | undefined;
let release: (() => void) | undefined;

// Calls that never reach the browser, so a hold lets them through.
export const synchronous = new Set([
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
  "frameLocator",
  "contentFrame",
  "nth",
  "first",
  "last",
  "filter",
  "and",
  "or",
  "describe",
  "page",
  "url",
  "isClosed",
  "context",
  "mainFrame",
  "frames",
  "viewportSize",
  "on",
  "once",
  "off",
  "addListener",
  "removeListener",
  "removeAllListeners",
  "listenerCount",
]);

/** Spike (dialogs): stops, holds or lets go the Run in progress at its next Playwright call. */
export const spikeRunGate = {
  hold() {
    if (held) return;
    held = new Promise((resolve) => (release = resolve));
  },
  refuse(reason: string) {
    refusal = reason;
    release?.();
    held = release = undefined;
  },
  allow() {
    refusal = undefined;
    release?.();
    held = release = undefined;
  },
  /** Called by the session when a top-level Run's action has ended, failed or not. */
  actionEnded() {
    spikeRunGate.onActionEnd?.();
    spikeRunGate.allow();
  },
  /**
   * Set by a Node host: which calls belong to a Page Object Action's own
   * code. Only those are held or refused; Ayme's own reads of the Page
   * Object, which go through the same wrapped locators, are not.
   */
  scope: undefined as
    { run<T>(execute: () => T): T; active(): boolean } | undefined,
  /** Runs a Page Object Action's method inside the scope. */
  runAction<T>(execute: () => T): T {
    const value = spikeRunGate.scope
      ? spikeRunGate.scope.run(execute)
      : execute();
    Promise.resolve(value).then(
      () => spikeRunGate.onMethodEnd?.("returned"),
      (error: unknown) => spikeRunGate.onMethodEnd?.(`threw ${String(error)}`)
    );
    return value;
  },
  /** Heard when a Page Object Action's method has returned or thrown. */
  onMethodEnd: undefined as ((outcome: string) => void) | undefined,
  /** Heard on each asynchronous call through a wrapped Page: started, ended, refused or released from a hold. */
  onCall: undefined as ((call: string, phase: string) => void) | undefined,
  /** Heard when a top-level Run's action has ended. */
  onActionEnd: undefined as (() => void) | undefined,
  /** Spike (hidden tab): heard at the start and end of each part of a Run ayme waits on. */
  onPhase: undefined as
    ((part: string, edge: "start" | "end") => void) | undefined,
  /** Spike (hidden tab): runs `execute` as the part `part` of a Run, heard by `onPhase`. */
  async timed<T>(part: string, execute: () => Promise<T>): Promise<T> {
    spikeRunGate.onPhase?.(part, "start");
    try {
      return await execute();
    } finally {
      spikeRunGate.onPhase?.(part, "end");
    }
  },
  /** The reason a refused call throws, while calls are refused. */
  get refusal() {
    return refusal;
  },
  /** Settles when a hold is released, while calls are held. */
  get held() {
    return held;
  },
  get state() {
    return refusal !== undefined ? "refused" : held ? "held" : "open";
  },
};

/** Spike (dialogs): what a refused call throws. */
export class RunStoppedError extends Error {
  override name = "RunStoppedError";
}
