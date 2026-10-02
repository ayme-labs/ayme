// PROBE: prototype of the proposed @ayme-dev/angular adapter, written against
// the runtime session API on main a94a159 (old option names: page, refTools).
import { isPlatformBrowser } from "@angular/common";
import {
  DestroyRef,
  InjectionToken,
  PLATFORM_ID,
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

export type AymeSetup = {
  ayme: RuntimeSession;
  webMCP: {
    publicationStatus: Signal<AymeWebMcpPublicationStatus>;
    retryPublication(): Promise<void>;
  };
};

const AYME = new InjectionToken<AymeSetup>("Ayme runtime");

export function provideAyme(
  options: AymeRuntimeOptions = {}
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: AYME,
      useFactory: (): AymeSetup => {
        if (inject(AYME, { skipSelf: true, optional: true }))
          throw new Error(
            "provideAyme cannot be nested beneath another Ayme runtime owner."
          );
        const ayme = createRuntimeSession(options);
        const destroyRef = inject(DestroyRef);
        const status = signal(ayme.getSnapshot());
        destroyRef.onDestroy(
          ayme.subscribe(() => status.set(ayme.getSnapshot()))
        );
        if (isPlatformBrowser(inject(PLATFORM_ID))) {
          (globalThis as any).__aymeProbe = {
            ayme,
            startedAt: performance.now(),
          };
          destroyRef.onDestroy(ayme.start());
        }
        return {
          ayme,
          webMCP: {
            publicationStatus: status.asReadonly(),
            retryPublication: ayme.retryPublication,
          },
        };
      },
    },
    // Eager: the runtime starts with the environment, not on first injection.
    provideEnvironmentInitializer(() => void inject(AYME)),
  ]);
}

export function injectAyme(): AymeSetup {
  assertInInjectionContext(injectAyme);
  const setup = inject(AYME, { optional: true });
  if (!setup)
    throw new Error("injectAyme requires provideAyme in an ancestor injector.");
  return setup;
}

export function injectPageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  assertInInjectionContext(injectPageObject);
  const { ayme } = injectAyme();
  const instance = ayme.construct(model);
  if (isPlatformBrowser(inject(PLATFORM_ID)))
    inject(DestroyRef).onDestroy(ayme.register(model, instance));
  return instance;
}
