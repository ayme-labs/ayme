import { createPage } from "./browserPage";
import { configurePageStateIgnore } from "./pageState";
import {
  constructPageObject,
  createAymeRuntime,
  registerPageObject,
  type PageObjectConstructor,
} from "./registry";
import {
  synchronizeWebMcpTools,
  waitForWebMcpDriver,
  type WebMcpRegistration,
} from "./webMcp";

declare const __AYME_WEBMCP_PUBLISH__: boolean | undefined;

export type AymeWebMcpPublicationStatus = Readonly<{
  state:
    "disabled" | "waiting" | "active" | "unavailable" | "failed" | "disposed";
  message: string;
}>;
export type AymePage = ConstructorParameters<PageObjectConstructor>[0];
export type AymeRuntimeOptions = {
  ignore?: (element: Element) => boolean;
};
type PageInstrumentation = (page: AymePage) => AymePage;
type Registration = {
  activate: () => { dispose(): void };
  active?: { dispose(): void };
};

export function createServerPageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  const prototype = (model as unknown as { prototype: object }).prototype;
  return Object.create(prototype) as T;
}

const pageInstrumentations = new Set<PageInstrumentation>();

export function installRuntimePageInstrumentation(
  instrumentation: PageInstrumentation
) {
  pageInstrumentations.add(instrumentation);
  return () => {
    pageInstrumentations.delete(instrumentation);
  };
}

function instrumentPage(page: AymePage) {
  let instrumented = page;
  for (const instrumentation of pageInstrumentations)
    instrumented = instrumentation(instrumented);
  return instrumented;
}

// Construction is inert. Frameworks start activity only when their owner commits.
export function createRuntimeSession(
  sourcePage?: AymePage,
  options: AymeRuntimeOptions = {}
) {
  let resolvedPage: AymePage | undefined;
  const getPage = () =>
    (resolvedPage ??= instrumentPage(sourcePage ?? createPage()));
  const enabled =
    typeof __AYME_WEBMCP_PUBLISH__ !== "undefined" && __AYME_WEBMCP_PUBLISH__;
  const initialStatus: AymeWebMcpPublicationStatus = {
    state: enabled ? "waiting" : "disabled",
    message: enabled
      ? "Waiting for the WebMCP driver."
      : "WebMCP publication is disabled.",
  };
  let status = Object.freeze(initialStatus);
  const subscribers = new Set<() => void>();
  const registrations = new Set<Registration>();
  let owner: ReturnType<typeof createAymeRuntime> | undefined;
  let controller: AbortController | undefined;
  let publication: WebMcpRegistration | undefined;
  let pending: Promise<void> | undefined;

  const setStatus = (next: AymeWebMcpPublicationStatus) => {
    status = Object.freeze(next);
    for (const listener of subscribers) listener();
  };
  const failed = (error: unknown) =>
    setStatus({
      state: "failed",
      message: `WebMCP publication failed: ${error instanceof Error ? error.message : String(error)}`,
    });

  function retryPublication(): Promise<void> {
    if (!enabled || !owner || publication) return Promise.resolve();
    if (pending) return pending;
    const signal = controller!.signal;
    setStatus(initialStatus);
    const attempt = (async () => {
      try {
        const driver = await waitForWebMcpDriver(2_000, signal);
        if (signal.aborted) return;
        if (!driver) {
          setStatus({
            state: "unavailable",
            message: "The WebMCP driver is unavailable.",
          });
          return;
        }
        let attemptFailed = false;
        const registration = await synchronizeWebMcpTools(driver, {
          signal,
          onError(error) {
            attemptFailed = true;
            if (signal.aborted) return;
            publication = undefined;
            failed(error);
          },
        });
        if (signal.aborted || attemptFailed) {
          registration.dispose();
          return;
        }
        publication = registration;
        setStatus({ state: "active", message: registration.message });
      } catch (error) {
        if (!signal.aborted) failed(error);
      }
    })();
    pending = attempt;
    void attempt.then(() => {
      if (pending === attempt) pending = undefined;
    });
    return attempt;
  }

  function stop() {
    if (!owner) return;
    controller?.abort();
    publication?.dispose();
    publication = undefined;
    pending = undefined;
    for (const registration of registrations) {
      registration.active?.dispose();
      registration.active = undefined;
    }
    owner.dispose();
    owner = undefined;
    configurePageStateIgnore(undefined);
    setStatus({ state: "disposed", message: "The Ayme runtime was disposed." });
  }

  return {
    get page() {
      return getPage();
    },
    getSnapshot: () => status,
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    retryPublication,
    construct<T extends object>(model: PageObjectConstructor<T>) {
      return constructPageObject(model, getPage());
    },
    register<T extends object>(model: PageObjectConstructor<T>, instance: T) {
      const registration: Registration = {
        activate: () => registerPageObject(model, instance),
      };
      if (owner) registration.active = registration.activate();
      registrations.add(registration);
      return () => {
        registration.active?.dispose();
        registrations.delete(registration);
      };
    },
    start() {
      if (owner)
        throw new Error("The Ayme runtime already has an active owner.");
      owner = createAymeRuntime(getPage());
      configurePageStateIgnore(options.ignore);
      controller = new AbortController();
      try {
        for (const registration of registrations)
          registration.active = registration.activate();
        setStatus(initialStatus);
        void retryPublication();
      } catch (error) {
        stop();
        throw error;
      }
      const startedOwner = owner;
      return () => {
        if (owner === startedOwner) stop();
      };
    },
  };
}

export type RuntimeSession = ReturnType<typeof createRuntimeSession>;
