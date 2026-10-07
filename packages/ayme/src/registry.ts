import type { PomManifest } from "./contracts";
import { createPage } from "./browserPage";
import type { Page } from "@playwright/test";
import type { ActionResult } from "./actionSequence";
import { litePageDriver } from "./litePageDriver";
import {
  createPomRegistry,
  type CallerAwarePomTool as RegistryCallerAwarePomTool,
} from "./pomRegistry";
import { RuntimeStateError } from "./errors";

export type {
  RegisteredPom,
  RegisteredPomRoot,
  RegisteredPomTarget,
} from "./pomRegistry";
export { validateValue } from "./pomRegistry";

/**
 * The browser runtime's Page Object registry: one module-level instance on
 * the Playwright Lite driver, for the runtime session, WebMCP publication,
 * page-state capture and the Inspector's read model. The registry itself, and
 * what it needs from a runtime, live in `pomRegistry.ts` and `pageDriver.ts`.
 */

export type PageObjectConstructor<T extends object = object> = new (
  page: Page
) => T;

/**
 * Package-internal: a live Page Object tool as the registry holds it. Its
 * `execute` runs it as the calling agent; `executeAs` for the caller given,
 * which is how the Goal Loop runs it as its model.
 */
export type CallerAwarePomTool = RegistryCallerAwarePomTool<ActionResult>;

const registry = createPomRegistry(litePageDriver);

let browserPage: Page | undefined;
let runtimeOwner: object | undefined;
const compiledPoms = new WeakMap<object, PomManifest>();

export function configureAymeRuntime(page: Page) {
  if (runtimeOwner)
    throw new RuntimeStateError(
      "The Ayme runtime already has an active owner."
    );
  browserPage = page;
}

export function requireAymeRuntimePage(): Page {
  if (!browserPage)
    throw new RuntimeStateError(
      "Configure the Ayme browser runtime before interacting."
    );
  return browserPage;
}

export function createAymeRuntime(page?: object) {
  if (runtimeOwner)
    throw new RuntimeStateError(
      "The Ayme runtime already has an active owner."
    );

  registry.reset();
  browserPage = undefined;
  const owner = {};
  const runtimePage = page ?? createPage();
  runtimeOwner = owner;
  browserPage = runtimePage as Page;

  return {
    page: runtimePage,
    dispose() {
      if (runtimeOwner !== owner) return;
      registry.reset();
      browserPage = undefined;
      runtimeOwner = undefined;
    },
  };
}

export function registerCompiledPom(PomClass: object, manifest: PomManifest) {
  compiledPoms.set(PomClass, manifest);
}

export function createPageRegistration<T extends object>(
  PomClass: PageObjectConstructor<T>
) {
  const page = browserPage;
  if (!page)
    throw new RuntimeStateError(
      "Configure the Ayme browser runtime before registering a page object."
    );

  const compiledPom = compiledPoms.get(PomClass);
  if (!compiledPom)
    throw new RuntimeStateError(
      "The imported page object has no compiler-derived Ayme metadata."
    );

  const instance = constructPageObject(PomClass, page);
  return registerPageObject(PomClass, instance);
}

export function constructPageObject<T extends object>(
  PomClass: PageObjectConstructor<T>,
  page: Page
): T {
  if (!compiledPoms.has(PomClass))
    throw new RuntimeStateError(
      "The imported page object has no compiler-derived Ayme metadata."
    );
  return new PomClass(page);
}

export function registerPageObject<T extends object>(
  PomClass: PageObjectConstructor<T>,
  instance: T
) {
  const compiledPom = compiledPoms.get(PomClass);
  if (!compiledPom)
    throw new RuntimeStateError(
      "The imported page object has no compiler-derived Ayme metadata."
    );
  const registration = registry.register(PomClass, compiledPom, instance);
  return { instance, dispose: registration.dispose };
}

export const probeRegisteredPomMembers = registry.probe;
export const listRegisteredPoms = registry.list;
export const getRegisteredPomStructure = registry.structure;
export const listRegisteredPomTargets = registry.listTargets;
export const listCollectionToolRoots = registry.listCollectionToolRoots;
export const subscribeToRegisteredPoms = registry.subscribe;

export async function listRegisteredPomRoots() {
  return (await registry.structure()).roots;
}

/** The live Page Object tools, as published. */
export function listRegisteredPomTools(): CallerAwarePomTool[] {
  return registry.listTools();
}

/**
 * Package-internal: the live Page Object tools with the run that takes a
 * caller, for the Goal Loop.
 */
export const listCallerAwarePomTools = listRegisteredPomTools;

export const listRegisteredTools = listRegisteredPomTools;
