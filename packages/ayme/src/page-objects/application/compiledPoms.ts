import type { Page } from "@playwright/test";
import type { PomManifest } from "../../shared";
import { RuntimeStateError } from "../../shared";

export type PageObjectConstructor<T extends object = object> = new (
  page: Page
) => T;

// The manifest the build compiled for each Page Object class. The build
// plugin's generated code registers it when the class's module is imported,
// before any runtime session exists.
const compiledPoms = new WeakMap<object, PomManifest>();

export function registerCompiledPom(PomClass: object, manifest: PomManifest) {
  compiledPoms.set(PomClass, manifest);
}

/** Package-internal: the manifest the build compiled for `PomClass`. */
export function compiledManifestOf(PomClass: object): PomManifest {
  const manifest = compiledPoms.get(PomClass);
  if (!manifest)
    throw new RuntimeStateError(
      "The imported page object has no compiler-derived Ayme metadata."
    );
  return manifest;
}

export function constructPageObject<T extends object>(
  PomClass: PageObjectConstructor<T>,
  page: Page
): T {
  compiledManifestOf(PomClass);
  return new PomClass(page);
}
