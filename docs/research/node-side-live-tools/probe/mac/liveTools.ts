// Scratch pilot (not committed). The smallest extraction of the registry's
// live-tool logic behind a page-driver port, with a real-Playwright adapter.
//
// What is copied from packages/ayme/src/registry.ts: root/member probing
// (probePomMembers, observeRoot, probeMembers), the activation rule
// (listCallerAwarePomTools, isLiveComponentRoot) and tool naming
// (createRegisteredTools and friends), reduced to what the pilot needs.
// What is reused unchanged: probePomRootState (pomReachability.ts).
import type { Locator, Page } from "@playwright/test";
import type {
  PomComponentManifest,
  PomComponentMemberManifest,
  PomManifest,
  PomMemberManifest,
  ToolManifest,
} from "../../src/contracts";
// `.ts` extension: the pilot runs on Node's native type stripping. tsx and
// vitest load TypeScript through esbuild with keepNames, which injects a
// `__name` helper into every function, including the in-page callback of
// probePomRootState; Playwright serializes that callback by source and the
// page has no `__name`, so the probe fails and (it catches everything) reads
// as "absent". Node's strip-types keeps the source as written.
import {
  probePomRootState,
  type PomRootState,
} from "../../src/pomReachability.ts";

/**
 * The port: what live Page Object observation needs from the page runtime.
 * Playwright Lite and real Playwright each give one adapter.
 */
export type PageDriver = {
  /** Whether a member value is this runtime's Locator. */
  isLocator(value: unknown): value is Locator;
  /** Page Object Presence and Availability of one root (ADR-0019/0020). */
  observeRoot(root: Locator): Promise<PomRootState>;
  /**
   * Wakes the observer when the page may have changed; the module coalesces
   * and re-probes. Returns the unsubscribe.
   */
  watch(onChange: () => void): () => void;
};

export type RootObservation = {
  path: string;
  present: boolean;
  available: boolean;
  count: number;
};

export type LiveTool = {
  name: string;
  description: string;
  /** "" for the registered POM's own tools; "a.b[]" for component tools. */
  componentPath: string;
  execute(args?: Record<string, unknown>): Promise<unknown>;
};

export type LiveTools = {
  register(manifest: PomManifest, instance: object): () => void;
  /** Probe every registration now and resolve when the live set is current. */
  probe(): Promise<void>;
  /** The roots as last observed, by registration. */
  observations(): ReadonlyMap<string, readonly RootObservation[]>;
  /** The live Page Object Tools, in registration and declaration order. */
  list(): readonly LiveTool[];
  subscribe(listener: (tools: readonly LiveTool[]) => void): () => void;
  dispose(): void;
};

type Registration = {
  manifest: PomManifest;
  instance: object;
  tools: readonly (LiveTool & { declaredRoot: boolean })[];
  roots: readonly RootObservation[];
};

export function createLiveTools(driver: PageDriver): LiveTools {
  const registrations = new Set<Registration>();
  const listeners = new Set<(tools: readonly LiveTool[]) => void>();
  let unwatch: (() => void) | undefined;
  let inFlight: Promise<void> | undefined;
  let pending = false;
  let lastKey = "";

  const notify = () => {
    const tools = list();
    const key = JSON.stringify(tools.map((tool) => tool.name));
    if (key === lastKey) return;
    lastKey = key;
    for (const listener of listeners) listener(tools);
  };

  const runProbe = (): Promise<void> => {
    if (inFlight) {
      pending = true;
      return inFlight;
    }
    pending = false;
    inFlight = (async () => {
      for (const registration of registrations)
        registration.roots = await probeRoots(driver, registration);
      notify();
    })().finally(() => {
      inFlight = undefined;
      if (pending) void runProbe();
    });
    return inFlight;
  };

  // The driver may wake us many times per frame; coalesce to one probe.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void runProbe();
    }, 0);
  };

  function list(): LiveTool[] {
    const active = new Map<string, LiveTool>();
    for (const registration of registrations)
      for (const tool of registration.tools) {
        const live =
          tool.componentPath === ""
            ? !tool.declaredRoot ||
              registration.roots.some(
                (root) => root.path === "" && isAvailable(root)
              )
            : registration.roots.some(
                (root) =>
                  isAvailable(root) &&
                  isLiveComponentRoot(tool.componentPath, `${root.path}.root`)
              );
        if (live && !active.has(tool.name)) active.set(tool.name, tool);
      }
    return [...active.values()];
  }

  return {
    register(manifest, instance) {
      const registration: Registration = {
        manifest,
        instance,
        tools: createTools(manifest, instance),
        roots: [],
      };
      registrations.add(registration);
      if (registrations.size === 1) unwatch = driver.watch(schedule);
      schedule();
      notify();
      return () => {
        registrations.delete(registration);
        if (registrations.size === 0) {
          unwatch?.();
          unwatch = undefined;
        }
        notify();
      };
    },
    probe: async () => {
      await runProbe();
      if (pending) await runProbe();
    },
    observations: () =>
      new Map(
        [...registrations].map((registration) => [
          registration.manifest.className,
          registration.roots,
        ])
      ),
    list,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      registrations.clear();
      unwatch?.();
      unwatch = undefined;
      if (timer) clearTimeout(timer);
    },
  };
}

const isAvailable = (root: RootObservation) => root.present && root.available;

// registry.ts isLiveComponentRoot
function isLiveComponentRoot(path: string, memberName: string) {
  const pattern = path
    .split(".")
    .map((segment) => {
      const collection = segment.endsWith("[]");
      const name = collection ? segment.slice(0, -2) : segment;
      return `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${collection ? "\\[\\d+\\]" : ""}`;
    })
    .join("\\.");
  return new RegExp(`^${pattern}\\.root$`).test(memberName);
}

// registry.ts probePomMembers + observeRoot + probeMembers, roots only.
async function probeRoots(
  driver: PageDriver,
  { manifest, instance }: Registration
): Promise<RootObservation[]> {
  const components = new Map(
    manifest.components.map((component) => [component.className, component])
  );
  const roots: RootObservation[] = [];
  const rootMember = manifest.members.find(
    (member) => member.kind === "locator" && member.memberName === "root"
  );
  if (rootMember) {
    try {
      const root = await readMember(instance, rootMember);
      if (driver.isLocator(root)) roots.push(await observe(driver, root, ""));
    } catch {
      // A missing or invalid declared root never falls back to rootless activation.
    }
  }
  await probeMembers(driver, instance, manifest.members, "", components, roots);
  return roots;
}

async function observe(
  driver: PageDriver,
  root: Locator,
  path: string
): Promise<RootObservation> {
  const count = await root.count();
  const state =
    count === 1
      ? await driver.observeRoot(root)
      : { present: false, available: false };
  return { path, count, ...state };
}

async function probeMembers(
  driver: PageDriver,
  instance: object,
  members: readonly PomMemberManifest[],
  prefix: string,
  components: ReadonlyMap<string, PomComponentManifest>,
  roots: RootObservation[],
  ancestors: ReadonlySet<object> = new Set()
) {
  if (ancestors.has(instance)) return;
  const next = new Set(ancestors).add(instance);
  for (const member of members) {
    if (member.kind !== "component") continue;
    const path = prefix ? `${prefix}.${member.memberName}` : member.memberName;
    const component = components.get(member.componentClassName);
    if (!component) continue;
    let value: unknown;
    try {
      value = await readMember(instance, member);
    } catch {
      continue;
    }
    const values = member.collection ? (value as unknown[]) : [value];
    for (const [index, candidate] of values.entries()) {
      const componentPath = member.collection ? `${path}[${index}]` : path;
      if (!isRecord(candidate) || !driver.isLocator(candidate.root)) continue;
      roots.push(await observe(driver, candidate.root, componentPath));
      await probeMembers(
        driver,
        candidate,
        component.members.filter(
          (child) => !(child.kind === "locator" && child.memberName === "root")
        ),
        componentPath,
        components,
        roots,
        next
      );
    }
  }
}

async function readMember(instance: object, member: PomMemberManifest) {
  const value = Reflect.get(instance, member.memberName) as unknown;
  if (member.access === "method")
    return await (value as (...args: unknown[]) => unknown).apply(instance, []);
  return await value;
}

// registry.ts createRegisteredTools and friends, without the WebMCP shapes,
// input validation, runAction (Settled Page, Change Record) and ref lookup.
function createTools(manifest: PomManifest, instance: object) {
  const declaredRoot = manifest.members.some(
    (member) => member.kind === "locator" && member.memberName === "root"
  );
  const components = new Map(
    manifest.components.map((component) => [component.className, component])
  );
  const tools: (LiveTool & { declaredRoot: boolean })[] = manifest.tools.map(
    (tool) => ({
      name: tool.toolName,
      description: tool.description,
      componentPath: "",
      declaredRoot,
      execute: (args) => call(instance, tool, args),
    })
  );
  const walk = (
    path: readonly PomComponentMemberManifest[],
    component: PomComponentManifest,
    seen: ReadonlySet<string>
  ) => {
    if (seen.has(component.className)) return;
    const componentPath = path
      .map((m) => `${m.memberName}${m.collection ? "[]" : ""}`)
      .join(".");
    const publicPath = path.map((m) => m.memberName).join(".");
    const collection = path.some((m) => m.collection);
    for (const action of component.tools)
      tools.push({
        name: `${manifest.className}.${publicPath}.${action.methodName}`,
        description: action.description,
        componentPath,
        declaredRoot,
        execute: async (args) => {
          if (collection)
            throw new Error(
              "Collection tools take a Structural Ref; the Node side has no ref space yet (open question)."
            );
          let current: unknown = instance;
          for (const member of path)
            current = await readMember(current as object, member);
          return call(current as object, action, args);
        },
      });
    for (const member of component.members) {
      if (member.kind !== "component") continue;
      const child = components.get(member.componentClassName);
      if (child)
        walk([...path, member], child, new Set(seen).add(component.className));
    }
  };
  for (const member of manifest.members) {
    if (member.kind !== "component") continue;
    const component = components.get(member.componentClassName);
    if (component) walk([member], component, new Set());
  }
  return tools;
}

async function call(
  instance: object,
  tool: ToolManifest,
  args: Record<string, unknown> = {}
) {
  const method = Reflect.get(instance, tool.methodName) as (
    ...args: unknown[]
  ) => unknown;
  return await method.apply(
    instance,
    tool.parameters.map((parameter) => args[parameter.name])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- The real-Playwright adapter -------------------------------------------

/**
 * A page driver over a real Playwright Page in Node. The wake-up source is a
 * MutationObserver in the page calling an exposed function; it is reinstalled
 * after every full load.
 */
export function playwrightPageDriver(page: Page): PageDriver {
  const listeners = new Set<() => void>();
  let exposed = false;
  const install = async () => {
    await page
      .evaluate(() => {
        const w = window as unknown as {
          __aymeNodeLiveChanged?: () => void;
          __aymeNodeLiveObserver?: MutationObserver;
        };
        if (w.__aymeNodeLiveObserver) return;
        const observer = new MutationObserver(() =>
          w.__aymeNodeLiveChanged?.()
        );
        observer.observe(document.documentElement, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
        w.__aymeNodeLiveObserver = observer;
        for (const event of [
          "scroll",
          "resize",
          "transitionend",
          "animationend",
        ])
          window.addEventListener(
            event,
            () => w.__aymeNodeLiveChanged?.(),
            true
          );
      })
      .catch(() => {});
  };
  return {
    isLocator(value): value is Locator {
      // Playwright's Locator is a class; its instances answer these. There
      // is no brand to check, unlike Playwright Lite's.
      return (
        isRecord(value) &&
        typeof value.count === "function" &&
        typeof value.evaluate === "function" &&
        typeof value.locator === "function" &&
        typeof value.page === "function"
      );
    },
    observeRoot: probePomRootState,
    watch(onChange) {
      listeners.add(onChange);
      const onLoad = () => void install();
      void (async () => {
        if (!exposed) {
          exposed = true;
          await page.exposeFunction("__aymeNodeLiveChanged", () => {
            for (const listener of listeners) listener();
          });
        }
        page.on("load", onLoad);
        await install();
      })();
      return () => {
        listeners.delete(onChange);
        page.off("load", onLoad);
      };
    },
  };
}
