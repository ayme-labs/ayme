/**
 * What a build without Ayme resolves `@ayme-dev/angular` to: the names of
 * the index with their types, over the runtime's absent entry, so an
 * application renders as with the real package. `provideAyme` provides an
 * inert session and the inject functions return its values; nothing here
 * starts, stops or checks for an owner, because there is nothing to own.
 */
import {
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
} from "@angular/core";
import type { Ayme, AymeOptions } from "@ayme-dev/ayme";
import { createAyme } from "@ayme-dev/ayme/absent";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";
import type { AymeSetup } from "./index";

export type {
  AymeOptions,
  AymeSetup,
  AymeWebMCP,
  AymeWebMcpPublicationStatus,
} from "./index";

const aymeSetup = new InjectionToken<AymeSetup>("Ayme setup");
let inert: AymeSetup | undefined;

function setup(ayme: Ayme): AymeSetup {
  return {
    ayme,
    webMCP: {
      publicationStatus: signal(ayme.webMCP.publicationStatus).asReadonly(),
      retryPublication: ayme.webMCP.retryPublication,
    },
  };
}

export function provideAyme(options: AymeOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    // The absent runtime reads the options for the publication error only.
    { provide: aymeSetup, useFactory: () => setup(createAyme(options)) },
    // Eager, so that error is logged when the application starts.
    provideEnvironmentInitializer(() => void inject(aymeSetup)),
  ]);
}

export function injectAyme(): AymeSetup {
  return (
    inject(aymeSetup, { optional: true }) ?? (inert ??= setup(createAyme()))
  );
}

export function injectPageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  return injectAyme().ayme.pom.register(model);
}

export function injectPeek(values: unknown, name: string, id?: string): void {
  void values;
  void name;
  void id;
}
