import {
  DestroyRef,
  InjectionToken,
  assertInInjectionContext,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
  type Signal,
} from "@angular/core";
import {
  createRuntimeSession,
  type AymeRuntimeOptions,
  type AymeWebMcpPublicationStatus,
  type RuntimeSession,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";

/** The options of `createRuntimeSession`: pageFactory, ignore, customTools, goalLoop and webMCP. */
export type AymeOptions = AymeRuntimeOptions;

export type AymeWebMCP = {
  /** The session's publication status; `disabled` unless `webMCP.enabled`. */
  readonly publicationStatus: Signal<AymeWebMcpPublicationStatus>;
  retryPublication(): Promise<void>;
};

export type AymeSetup = {
  /** The runtime session. */
  readonly ayme: RuntimeSession;
  readonly webMCP: AymeWebMCP;
};

const aymeSetup = new InjectionToken<AymeSetup>("Ayme setup");

const inBrowser = () => typeof window !== "undefined";

/**
 * Starts Ayme with the environment injector that receives these providers,
 * before the root component is created, and stops it when that injector is
 * destroyed. Put it in the application config.
 */
export function provideAyme(options: AymeOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: aymeSetup,
      useFactory: (): AymeSetup => {
        const ayme = createRuntimeSession(options);
        const destroyRef = inject(DestroyRef);
        const publicationStatus = signal(ayme.webMCP.publicationStatus);
        destroyRef.onDestroy(
          ayme.webMCP.subscribe(() =>
            publicationStatus.set(ayme.webMCP.publicationStatus)
          )
        );
        if (inBrowser()) destroyRef.onDestroy(ayme.start());
        return {
          ayme,
          webMCP: {
            publicationStatus: publicationStatus.asReadonly(),
            retryPublication: ayme.webMCP.retryPublication,
          },
        };
      },
    },
    // Eager: the runtime starts with the environment, not on first injection.
    provideEnvironmentInitializer(() => void inject(aymeSetup)),
  ]);
}

/** Reads the Ayme setup of the nearest `provideAyme`. Call in an injection context. */
export function injectAyme(): AymeSetup {
  assertInInjectionContext(injectAyme);
  return inject(aymeSetup);
}

/**
 * Returns the Page Object for the caller's lifetime: its tools are registered
 * until the caller's `DestroyRef` fires. Call in an injection context.
 */
export function injectPageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  assertInInjectionContext(injectPageObject);
  const { ayme } = injectAyme();
  const instance = ayme.construct(model);
  if (inBrowser()) inject(DestroyRef).onDestroy(ayme.register(model, instance));
  return instance;
}
