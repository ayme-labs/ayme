import {
  DestroyRef,
  InjectionToken,
  afterNextRender,
  assertInInjectionContext,
  inject,
  isSignal,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
  type Signal,
} from "@angular/core";
import {
  createAyme,
  type Ayme,
  type AymeOptions,
  type AymeWebMcpPublicationStatus,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";

export type { AymeOptions, AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";

export type AymeWebMCP = {
  /** The session's publication status; `disabled` unless `webMCP.enabled`. */
  readonly publicationStatus: Signal<AymeWebMcpPublicationStatus>;
  retryPublication(): Promise<void>;
};

export type AymeSetup = {
  /** The runtime session. */
  readonly ayme: Ayme;
  readonly webMCP: AymeWebMCP;
};

const aymeSetup = new InjectionToken<AymeSetup>("Ayme setup");

const inBrowser = () => typeof window !== "undefined";

/**
 * Starts Ayme with the environment injector that receives these providers,
 * before the root component is created, and stops it when that injector is
 * destroyed. Put it in the application config, not in route providers: the
 * router does not destroy a route's environment injector on navigation.
 */
export function provideAyme(options: AymeOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: aymeSetup,
      useFactory: (): AymeSetup => {
        if (inject(aymeSetup, { skipSelf: true, optional: true }))
          throw new Error(
            "provideAyme cannot be nested beneath another Ayme runtime owner."
          );
        const ayme = createAyme(options);
        const destroyRef = inject(DestroyRef);
        const publicationStatus = signal(ayme.webMCP.publicationStatus);
        destroyRef.onDestroy(
          ayme.webMCP.subscribe((status) => publicationStatus.set(status))
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
  const setup = inject(aymeSetup, { optional: true });
  if (!setup)
    throw new Error("Ayme requires provideAyme() in an ancestor injector.");
  return setup;
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
  inject(DestroyRef).onDestroy(() => ayme.pom.unregister(model));
  return ayme.pom.register(model);
}

let instances = 0;

/**
 * Adds the caller's instance of the Peek `name` until its `DestroyRef` fires,
 * through `ayme.peek`. It is added after the first render, so never on the
 * server. The agent reads `values` when it asks, calling `values` if it is a
 * signal, or each top-level property that is one. `id` defaults to one per
 * caller. Call in an injection context.
 */
export function injectPeek(values: unknown, name: string, id?: string): void {
  assertInInjectionContext(injectPeek);
  const { ayme } = injectAyme();
  const instanceId = id ?? `ng-${++instances}`;
  let remove: (() => void) | undefined;
  inject(DestroyRef).onDestroy(() => remove?.());
  // Never runs during server rendering, and not after the caller is destroyed.
  afterNextRender(() => {
    remove = ayme.peek(() => readValues(values), name, instanceId);
  });
}

function readValues(values: unknown): unknown {
  if (isSignal(values)) return values();
  if (!isPlainObject(values)) return values;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      isSignal(value) ? value() : value,
    ])
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
