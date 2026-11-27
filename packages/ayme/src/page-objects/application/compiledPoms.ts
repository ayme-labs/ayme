import type { Page } from "@playwright/test";
import { modelOption } from "../domain/decorators";
import type { PomComponentManifest, PomManifest } from "../../shared";
import { RuntimeStateError } from "../../shared";

export type PageObjectConstructor<T extends object = object> = new (
  page: Page
) => T;

// The manifest the build compiled for each Page Object class. The build
// plugin's generated code registers it when the class's module is imported,
// before any runtime session exists.
const compiledPoms = new WeakMap<object, PomManifest>();

// Root declarations are known before any instances exist, even for empty
// collections. An HMR replacement updates the same compiled declaration.
const compiledRoots = new Map<string, boolean>();
// The declarations each class registered with, of its own root and of the
// classes it reaches, read as it registered: its module's imports register
// before it, so they come from the same build. A later build loaded beside
// it, such as a rebuild a Session has not checked yet, leaves them as they
// were.
const declaredWith = new WeakMap<object, ReadonlyMap<string, boolean>>();
const declarationKey = (manifest: PomComponentManifest) =>
  JSON.stringify([manifest.file, manifest.className]);

/** Whether `manifest`'s class declares a root, as `PomClass`, which reaches
 * it, was compiled with; the newest declaration when `PomClass` registered
 * before it. */
export function compiledRootDeclared(
  PomClass: object,
  manifest: PomComponentManifest
): boolean | undefined {
  const key = declarationKey(manifest);
  return declaredWith.get(PomClass)?.get(key) ?? compiledRoots.get(key);
}

export function registerCompiledPom(PomClass: object, manifest: PomManifest) {
  compiledPoms.set(PomClass, manifest);
  compiledRoots.set(
    declarationKey(manifest),
    modelOption(PomClass, "root") !== undefined
  );
  declaredWith.set(
    PomClass,
    new Map(
      [manifest, ...manifest.components].flatMap((node) => {
        const key = declarationKey(node);
        const root = compiledRoots.get(key);
        return root === undefined ? [] : [[key, root] as const];
      })
    )
  );
}

/** Package-internal: the manifest the build compiled for `PomClass`. */
export function compiledManifestOf(PomClass: object): PomManifest {
  const manifest = compiledPoms.get(PomClass);
  if (!manifest) throw uncompiledPageObjectError(PomClass);
  return manifest;
}

function uncompiledPageObjectError(PomClass: object) {
  // A static `name` can be overridden with any value.
  const { name } = PomClass as { name: unknown };
  const label =
    typeof name === "string" && name ? name : "An anonymous page object class";
  return new RuntimeStateError(
    `${label} has no compiler-derived ayme metadata.`
  );
}

export function constructPageObject<T extends object>(
  PomClass: PageObjectConstructor<T>,
  page: Page
): T {
  compiledManifestOf(PomClass);
  return new PomClass(page);
}
