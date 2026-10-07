import type {
  JsonSchema,
  JsonValue,
  PomComponentManifest,
  PomComponentMemberManifest,
  PomManifest,
  PomMemberManifest,
  PomMemberObservation,
  RegisteredPomTool,
  ToolManifest,
} from "./contracts";
import { isJsonPrimitive } from "./contracts";
import { AriaRefSchema } from "@ayme-dev/core/structural-observation";
import type { Locator } from "@playwright/test";
import type { PageDriver } from "./pageDriver";
import type { Caller } from "./interactionHistory";
import {
  RefResolutionError,
  RuntimeStateError,
  ToolInputError,
} from "./errors";

/**
 * The Page Object registry: which Page Objects are registered, what their
 * members and roots look like right now, and which of their tools are live.
 * It runs the same way inside the document and in Node; everything that
 * differs between the two runtimes comes through the `PageDriver` it is given
 * (ADR-0019, ADR-0020, ADR-0025).
 */

type LiveRegisteredPomTool<Result extends JsonValue> = Omit<
  RegisteredPomTool,
  "execute"
> & {
  componentPath?: string;
  execute(args: unknown): Promise<Result>;
};

/** Runs a Page Object tool for the caller it is given. */
type CallerRun<Result extends JsonValue> = (
  input: unknown,
  caller: Caller
) => Promise<Result>;

/**
 * Package-internal: a live Page Object tool as the registry holds it. Its
 * `execute` runs it as the calling agent; `executeAs` for the caller given,
 * which is how the Goal Loop runs it as its model.
 */
export type CallerAwarePomTool<Result extends JsonValue = JsonValue> =
  LiveRegisteredPomTool<Result> & {
    readonly executeAs: CallerRun<Result>;
  };

export type RegisteredPom = {
  id: string;
  instance: object;
  manifest: PomManifest;
  memberObservations: readonly PomMemberObservation[];
  tools: readonly (Omit<RegisteredPomTool, "execute"> & {
    componentPath?: string;
    execute(args: unknown): Promise<JsonValue>;
  })[];
};

export type RegisteredPomRoot = {
  label: string;
  element: Element;
};

/**
 * An element a Page Object member holds, at the member's concrete path, e.g.
 * "ListPage.items[0].nameButton", or "ListPage.items[0].root" for a
 * component's root.
 */
export type RegisteredPomTarget = {
  path: string;
  element: Element;
};

/** One declared root as last observed, with the path of the member holding it. */
export type ObservedPomRoot = {
  path: string;
  element: Element | undefined;
  present: boolean;
  available: boolean;
};

type ObservedRegisteredPom<Result extends JsonValue> = Omit<
  RegisteredPom,
  "tools"
> & {
  pomClass: object;
  rootObservations: readonly ObservedPomRoot[];
  tools: readonly CallerAwarePomTool<Result>[];
};

export type PomRegistration = {
  instance: object;
  dispose(): void;
};

export type PomRegistry<Result extends JsonValue = JsonValue> = {
  /** Register a constructed Page Object under its compiled manifest. */
  register(
    PomClass: object,
    manifest: PomManifest,
    instance: object
  ): PomRegistration;
  /** Drop every registration and stop watching the page. */
  reset(): void;
  /** Observe every registration now, and once more if the page moved meanwhile. */
  probe(): Promise<void>;
  list(): RegisteredPom[];
  /** The live Page Object tools, in registration and declaration order. */
  listTools(): CallerAwarePomTool<Result>[];
  /**
   * The present Page Object Roots each tool that goes through a collection
   * acts on, by tool name, labelled as the page state labels them. A tool
   * whose path holds no collection is absent from the map.
   */
  listCollectionToolRoots(): Map<string, RegisteredPomRoot[]>;
  /** Capture labels and exclusions from the same completed observation. */
  structure(): Promise<{
    roots: RegisteredPomRoot[];
    absentElements: Element[];
  }>;
  /**
   * Every element the registered Page Objects' members hold, one target per
   * element and concrete member path, in registration and declaration order.
   * Paths through collections carry their item indices.
   */
  listTargets(): Promise<RegisteredPomTarget[]>;
  /** Called on every registration, disposal and changed observation. */
  subscribe(subscriber: () => void): () => void;
};

export function createPomRegistry<Result extends JsonValue>(
  driver: PageDriver<Result>
): PomRegistry<Result> {
  const registeredPoms = new Set<ObservedRegisteredPom<Result>>();
  const subscribers = new Set<() => void>();
  let stopWatching: (() => void) | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let probeLifetime = 0;
  let probeInFlight: Promise<void> | undefined;
  let probePending = false;

  function register(
    PomClass: object,
    manifest: PomManifest,
    instance: object
  ): PomRegistration {
    // Tools are named after the class, so a different class with the same name
    // would have its tools hidden by the first one registered.
    for (const registered of registeredPoms)
      if (
        registered.id === manifest.className &&
        registered.pomClass !== PomClass
      )
        throw new RuntimeStateError(
          `Cannot register the Page Object "${manifest.className}": a different class with that name is already registered. Rename one of them so their tools do not share names.`
        );
    const registration: ObservedRegisteredPom<Result> = {
      id: manifest.className,
      pomClass: PomClass,
      instance,
      manifest,
      memberObservations: [],
      rootObservations: [],
      tools: createRegisteredTools(manifest, instance),
    };
    const registryWasEmpty = registeredPoms.size === 0;
    registeredPoms.add(registration);
    if (registryWasEmpty) startWatching();
    else scheduleProbe();
    notifySubscribers();

    return {
      instance,
      dispose() {
        if (!registeredPoms.delete(registration)) return;
        if (registeredPoms.size === 0) stopWatchingPage();
        notifySubscribers();
      },
    };
  }

  function reset() {
    const hadRegistrations = registeredPoms.size > 0;
    registeredPoms.clear();
    stopWatchingPage();
    if (hadRegistrations) notifySubscribers();
  }

  function startWatching() {
    stopWatching = driver.watch(scheduleProbe);
    scheduleProbe();
  }

  function stopWatchingPage() {
    probeLifetime += 1;
    probeInFlight = undefined;
    probePending = false;
    stopWatching?.();
    stopWatching = undefined;
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    probeTimer = undefined;
  }

  function scheduleProbe() {
    probePending = true;
    if (probeInFlight || probeTimer !== undefined) return;
    probeTimer = setTimeout(() => {
      probeTimer = undefined;
      void runProbe().catch(() => {});
    }, 0);
  }

  async function probe(): Promise<void> {
    const lifetime = probeLifetime;
    await runProbe();
    // Await at most one follow-up. A live page need not become quiet to be read.
    if (lifetime === probeLifetime && probePending) await runProbe();
  }

  function runProbe(): Promise<void> {
    if (probeInFlight) return probeInFlight;
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    probeTimer = undefined;
    probePending = false;
    const lifetime = probeLifetime;
    probeInFlight = Promise.resolve()
      .then(() => probeRegistrations(lifetime))
      .finally(() => {
        if (lifetime !== probeLifetime) return;
        probeInFlight = undefined;
        if (probePending) scheduleProbe();
      });
    return probeInFlight;
  }

  async function probeRegistrations(lifetime: number): Promise<void> {
    if (lifetime !== probeLifetime) return;
    const results = await Promise.all(
      [...registeredPoms].map(async (registration) => ({
        registration,
        ...(await probePomMembers(registration)),
      }))
    );
    if (lifetime !== probeLifetime) return;

    let changed = false;
    for (const {
      registration,
      memberObservations,
      rootObservations,
    } of results) {
      if (!registeredPoms.has(registration)) continue;
      const sameRoots =
        registration.rootObservations.length === rootObservations.length &&
        registration.rootObservations.every((root, index) => {
          const next = rootObservations[index];
          return (
            next !== undefined &&
            root.path === next.path &&
            root.element === next.element &&
            root.present === next.present &&
            root.available === next.available
          );
        });
      if (
        sameRoots &&
        sameObservations(registration.memberObservations, memberObservations)
      )
        continue;
      registration.memberObservations = memberObservations;
      registration.rootObservations = rootObservations;
      changed = true;
    }
    if (changed) notifySubscribers();
  }

  function list(): RegisteredPom[] {
    return [...registeredPoms];
  }

  async function structure() {
    await probe();
    const observations = [...registeredPoms].flatMap((registration) =>
      registration.rootObservations.map((root) => ({
        ...root,
        label: root.path ? `${registration.id}.${root.path}` : registration.id,
      }))
    );
    const roots = observations
      .filter(isRootPresent)
      .map(({ label, element }) => ({ label, element }));
    const present = new Set(roots.map((root) => root.element));
    const absentElements = [
      ...new Set(
        observations.flatMap((root) =>
          !root.present &&
          root.element?.isConnected &&
          !present.has(root.element)
            ? [root.element]
            : []
        )
      ),
    ];
    return { roots, absentElements };
  }

  async function listTargets(): Promise<RegisteredPomTarget[]> {
    const targets: RegisteredPomTarget[] = [];
    for (const registration of registeredPoms) {
      const components = new Map(
        registration.manifest.components.map((component) => [
          component.className,
          component,
        ])
      );
      await collectPomTargets(
        registration.instance,
        registration.manifest.members,
        registration.id,
        components,
        targets
      );
    }
    return targets;
  }

  function listTools(): CallerAwarePomTool<Result>[] {
    const activeTools = new Map<string, CallerAwarePomTool<Result>>();
    for (const registration of registeredPoms) {
      const declaredRoot = registration.manifest.members.some(
        (member) => member.kind === "locator" && member.memberName === "root"
      );
      for (const tool of registration.tools) {
        const componentPath = tool.componentPath;
        const active =
          componentPath === undefined
            ? !declaredRoot ||
              registration.rootObservations.some(
                (root) => root.path === "" && isRootAvailable(root)
              )
            : registration.rootObservations.some(
                (root) =>
                  isRootAvailable(root) &&
                  isLiveComponentRoot(componentPath, `${root.path}.root`)
              );
        if (active && !activeTools.has(tool.name))
          activeTools.set(tool.name, tool);
      }
    }
    return [...activeTools.values()];
  }

  function listCollectionToolRoots(): Map<string, RegisteredPomRoot[]> {
    const rootsByTool = new Map<string, RegisteredPomRoot[]>();
    for (const registration of registeredPoms) {
      for (const tool of registration.tools) {
        const instancePath = innermostCollectionPath(tool.componentPath);
        if (instancePath === undefined) continue;
        const roots = registration.rootObservations.flatMap((root) =>
          isRootPresent(root) &&
          isLiveComponentRoot(instancePath, `${root.path}.root`)
            ? [
                {
                  label: `${registration.id}.${root.path}`,
                  element: root.element,
                },
              ]
            : []
        );
        rootsByTool.set(tool.name, [
          ...(rootsByTool.get(tool.name) ?? []),
          ...roots,
        ]);
      }
    }
    return rootsByTool;
  }

  function subscribe(subscriber: () => void) {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  }

  function notifySubscribers() {
    for (const subscriber of subscribers) subscriber();
  }

  function createRegisteredTools(manifest: PomManifest, instance: object) {
    const pageTools = manifest.tools.map((tool) =>
      createRegisteredTool(manifest.className, instance, tool)
    );
    const components = new Map(
      manifest.components.map((component) => [component.className, component])
    );
    const componentTools = manifest.members.flatMap((member) => {
      if (member.kind !== "component") return [];
      const component = components.get(member.componentClassName);
      if (!component) return [];
      return createComponentTools(
        manifest.className,
        instance,
        [member],
        component,
        components
      );
    });
    return [...pageTools, ...componentTools];
  }

  function createRegisteredTool(
    pomId: string,
    instance: object,
    tool: ToolManifest
  ): CallerAwarePomTool<Result> {
    const executeAs: CallerRun<Result> = async (args, caller) =>
      await executeTool(instance, tool, args, caller);
    return {
      pomId,
      methodName: tool.methodName,
      name: tool.toolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      parameters: tool.parameters,
      execute: (args) => executeAs(args, "agent"),
      executeAs,
    };
  }

  function createComponentTools(
    pomId: string,
    pageInstance: object,
    path: readonly PomComponentMemberManifest[],
    component: PomComponentManifest,
    components: ReadonlyMap<string, PomComponentManifest>,
    componentPath: ReadonlySet<string> = new Set()
  ): CallerAwarePomTool<Result>[] {
    if (componentPath.has(component.className)) return [];
    const nextComponentPath = new Set(componentPath).add(component.className);
    const tools = component.tools.map((action) =>
      createComponentTool(pomId, pageInstance, path, component, action)
    );
    const nestedTools = component.members.flatMap((member) => {
      if (member.kind !== "component") return [];
      const childComponent = components.get(member.componentClassName);
      if (!childComponent) return [];
      return createComponentTools(
        pomId,
        pageInstance,
        [...path, member],
        childComponent,
        components,
        nextComponentPath
      );
    });
    return [...tools, ...nestedTools];
  }

  function createComponentTool(
    pomId: string,
    pageInstance: object,
    path: readonly PomComponentMemberManifest[],
    component: PomComponentManifest,
    action: ToolManifest
  ): CallerAwarePomTool<Result> {
    const componentPath = componentPathFor(path);
    const collectionCount = path.filter((member) => member.collection).length;
    if (collectionCount === 0)
      return createSingularComponentTool(
        pomId,
        pageInstance,
        path,
        component,
        action,
        componentPath
      );

    const wrapper = refComponentToolManifest(pomId, path, action);
    const executeAs: CallerRun<Result> = async (input, caller) => {
      const values = validatedArguments(wrapper, input);
      const ref = AriaRefSchema.parse(values[0] as string);
      const args = values[1];
      const toolPath = `${pomId}.${publicComponentPath(path)}`;
      const element = await resolveRefToElement(
        ref,
        wrapper.toolName,
        toolPath
      );
      const componentInstance = await resolveComponentByElementStep(
        pageInstance,
        path,
        0,
        element
      );
      if (!componentInstance || !isRecord(componentInstance)) {
        throw new RefResolutionError(
          `Ref "${ref}" does not match a present ${component.className} instance at ${toolPath} (tool ${wrapper.toolName}).`
        );
      }
      return await executeTool(componentInstance, action, args, caller);
    };
    return {
      pomId,
      componentClassName: component.className,
      componentPath,
      methodName: action.methodName,
      name: wrapper.toolName,
      description: action.description,
      inputSchema: wrapper.inputSchema,
      parameters: wrapper.parameters,
      execute: (input) => executeAs(input, "agent"),
      executeAs,
    };
  }

  function createSingularComponentTool(
    pomId: string,
    pageInstance: object,
    path: readonly PomComponentMemberManifest[],
    component: PomComponentManifest,
    action: ToolManifest,
    componentPath: string
  ): CallerAwarePomTool<Result> {
    const executeAs: CallerRun<Result> = async (input, caller) => {
      const componentInstance = await resolveSingularComponent(
        pageInstance,
        path
      );
      if (!componentInstance || !isRecord(componentInstance)) {
        throw new RefResolutionError(
          `No ${component.className} instance exists at ${pomId}.${publicComponentPath(path)}.`
        );
      }
      return await executeTool(componentInstance, action, input, caller);
    };
    return {
      pomId,
      componentClassName: component.className,
      componentPath,
      methodName: action.methodName,
      name: `${pomId}.${publicComponentPath(path)}.${action.methodName}`,
      description: action.description,
      inputSchema: action.inputSchema,
      parameters: action.parameters,
      execute: (input) => executeAs(input, "agent"),
      executeAs,
    };
  }

  async function resolveRefToElement(
    ref: string,
    toolName: string,
    toolPath: string
  ): Promise<Element> {
    if (!driver.resolveRef)
      throw new RefResolutionError(
        `Ref "${ref}" cannot address an instance at ${toolPath} (tool ${toolName}): this runtime has no Structural Refs.`
      );
    const resolution = await driver.resolveRef(ref);
    if ("reason" in resolution)
      throw new RefResolutionError(
        `Ref "${ref}" does not match a present instance at ${toolPath} (tool ${toolName}): ${resolution.reason}.`
      );
    return resolution.element;
  }

  async function resolveComponentByElementStep(
    current: unknown,
    path: readonly PomComponentMemberManifest[],
    pathIndex: number,
    targetElement: Element
  ): Promise<unknown> {
    if (pathIndex >= path.length) return undefined;
    if (!isRecord(current)) return undefined;
    const member = path[pathIndex]!;
    const value = await readMember(current, member);

    if (!member.collection) {
      return resolveComponentByElementStep(
        value,
        path,
        pathIndex + 1,
        targetElement
      );
    }

    const instances = asComponents(value);
    const hasNestedCollection = path
      .slice(pathIndex + 1)
      .some((m) => m.collection);

    for (const candidate of instances) {
      if (!isPomComponent(candidate)) continue;

      if (hasNestedCollection) {
        const result = await resolveComponentByElementStep(
          candidate,
          path,
          pathIndex + 1,
          targetElement
        );
        if (result !== undefined) return result;
      } else {
        const elements = locatorElements(candidate.root);
        if (elements.length === 1 && elements[0] === targetElement) {
          // Walk any trailing singular members after the innermost collection.
          let resolved: unknown = candidate;
          for (let i = pathIndex + 1; i < path.length; i++) {
            if (!isRecord(resolved)) return undefined;
            resolved = await readMember(resolved, path[i]!);
          }
          return resolved;
        }
      }
    }

    return undefined;
  }

  async function probePomMembers(registration: RegisteredPom) {
    const components = new Map(
      registration.manifest.components.map((component) => [
        component.className,
        component,
      ])
    );
    const rootObservations: ObservedPomRoot[] = [];
    const rootMember = registration.manifest.members.find(
      (member) => member.kind === "locator" && member.memberName === "root"
    );
    if (rootMember) {
      try {
        const root = await readMember(registration.instance, rootMember);
        if (driver.isLocator(root))
          await observeRoot(root, "", rootObservations);
      } catch {
        // A missing or invalid declared root never falls back to rootless activation.
      }
    }
    const memberObservations = await probeMembers(
      registration.instance,
      registration.manifest.members,
      "",
      components,
      rootObservations
    );
    return { memberObservations, rootObservations };
  }

  async function observeRoot(
    root: Locator,
    path: string,
    observations: ObservedPomRoot[]
  ): Promise<number> {
    const observation = await driver.observeRoot(root);
    observations.push({
      path,
      element: observation.element,
      present: observation.present,
      available: observation.available,
    });
    return observation.count;
  }

  async function collectPomTargets(
    instance: object,
    members: readonly PomMemberManifest[],
    prefix: string,
    components: ReadonlyMap<string, PomComponentManifest>,
    targets: RegisteredPomTarget[],
    componentClasses: ReadonlySet<string> = new Set()
  ): Promise<void> {
    for (const member of members) {
      const memberPath = `${prefix}.${member.memberName}`;
      try {
        const value = await readMember(instance, member);
        if (member.kind === "locator") {
          if (!driver.isLocator(value)) continue;
          for (const element of locatorElements(value))
            targets.push({ path: memberPath, element });
          continue;
        }

        const component = components.get(member.componentClassName);
        if (!component) continue;
        const values = member.collection ? asComponents(value) : [value];
        for (const [index, candidate] of values.entries()) {
          if (!isPomComponent(candidate)) continue;
          const componentPath = member.collection
            ? `${memberPath}[${index}]`
            : memberPath;
          for (const element of locatorElements(candidate.root))
            targets.push({ path: `${componentPath}.root`, element });
          if (componentClasses.has(component.className)) continue;
          await collectPomTargets(
            candidate,
            component.members.filter(
              (child) =>
                !(child.kind === "locator" && child.memberName === "root")
            ),
            componentPath,
            components,
            targets,
            new Set(componentClasses).add(component.className)
          );
        }
      } catch {
        continue;
      }
    }
  }

  async function probeMembers(
    instance: object,
    members: readonly PomMemberManifest[],
    prefix: string,
    components: ReadonlyMap<string, PomComponentManifest>,
    roots: ObservedPomRoot[],
    ancestors: ReadonlySet<object> = new Set()
  ): Promise<PomMemberObservation[]> {
    if (ancestors.has(instance)) return [];
    const nextAncestors = new Set(ancestors).add(instance);
    const observations: PomMemberObservation[] = [];

    for (const member of members) {
      const memberPath = prefix
        ? `${prefix}.${member.memberName}`
        : member.memberName;
      try {
        const value = await readMember(instance, member);
        if (member.kind === "locator") {
          if (!driver.isLocator(value))
            throw new RuntimeStateError(
              `POM member ${memberPath} is not a browser locator.`
            );
          observations.push({
            memberName: memberPath,
            kind: "locator",
            access: member.access,
            count: await value.count(),
          });
          continue;
        }

        const componentManifest = components.get(member.componentClassName);
        if (!componentManifest)
          throw new RuntimeStateError(
            `No metadata found for component ${member.componentClassName}.`
          );
        const componentValues = member.collection
          ? asComponents(value)
          : [value];
        if (member.collection) {
          observations.push({
            memberName: memberPath,
            kind: "component-collection",
            access: member.access,
            count: componentValues.length,
          });
        }

        for (const [index, componentValue] of componentValues.entries()) {
          const componentPath = member.collection
            ? `${memberPath}[${index}]`
            : memberPath;
          if (!isPomComponent(componentValue)) {
            observations.push({
              memberName: `${componentPath}.root`,
              kind: "component-root",
              count: 0,
              error: `POM component ${componentPath} does not expose a browser locator root.`,
            });
            continue;
          }

          observations.push({
            memberName: `${componentPath}.root`,
            kind: "component-root",
            count: await observeRoot(componentValue.root, componentPath, roots),
          });
          const childMembers = componentManifest.members.filter(
            (child) =>
              !(child.kind === "locator" && child.memberName === "root")
          );
          observations.push(
            ...(await probeMembers(
              componentValue,
              childMembers,
              componentPath,
              components,
              roots,
              nextAncestors
            ))
          );
        }
      } catch (error) {
        observations.push({
          memberName:
            member.kind === "component" && !member.collection
              ? `${memberPath}.root`
              : memberPath,
          kind:
            member.kind === "locator"
              ? "locator"
              : member.collection
                ? "component-collection"
                : "component-root",
          access: member.access,
          count: 0,
          error: errorMessage(error),
        });
      }
    }

    return observations;
  }

  async function executeTool(
    instance: object,
    tool: ToolManifest,
    args: unknown,
    caller: Caller
  ): Promise<Result> {
    const method = Reflect.get(instance, tool.methodName);
    if (!isCallable(method))
      throw new RuntimeStateError(
        `POM method ${tool.methodName} is not callable.`
      );
    const parameters = validatedArguments(tool, args);
    return driver.run(
      () => method.apply(instance, parameters),
      { tool: tool.toolName, args },
      caller
    );
  }

  function locatorElements(locator: Locator): Element[] {
    return driver.locatorElements?.(locator) ?? [];
  }

  function isPomComponent(value: unknown): value is { root: Locator } {
    return isRecord(value) && driver.isLocator(value.root);
  }

  return {
    register,
    reset,
    probe,
    list,
    listTools,
    listCollectionToolRoots,
    structure,
    listTargets,
    subscribe,
  };
}

function sameObservations(
  left: readonly PomMemberObservation[],
  right: readonly PomMemberObservation[]
) {
  return (
    left.length === right.length &&
    left.every((observation, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        observation.memberName === candidate.memberName &&
        observation.kind === candidate.kind &&
        observation.count === candidate.count &&
        observation.access === candidate.access &&
        observation.error === candidate.error
      );
    })
  );
}

function isRootPresent<T extends ObservedPomRoot>(
  root: T
): root is T & { element: Element } {
  return root.present && root.element?.isConnected === true;
}

/**
 * Whether a root's tools are live. Inside the document the observation also
 * holds the element, which must still be connected; in Node the observation
 * stands on its own.
 */
function isRootAvailable(root: ObservedPomRoot) {
  return (
    root.available &&
    root.present &&
    (root.element === undefined || root.element.isConnected)
  );
}

/**
 * The path of the instance a collection tool is targeted by: everything up to
 * and including the last collection segment. Members after it are walked from
 * that instance, so `items[].child` is addressed through `items[]`.
 * Undefined when the path holds no collection.
 */
function innermostCollectionPath(componentPath: string | undefined) {
  if (componentPath === undefined) return undefined;
  const segments = componentPath.split(".");
  const last = segments.findLastIndex((segment) => segment.endsWith("[]"));
  return last === -1 ? undefined : segments.slice(0, last + 1).join(".");
}

function isLiveComponentRoot(path: string, memberName: string) {
  const pattern = path
    .split(".")
    .map((segment) => {
      const collection = segment.endsWith("[]");
      const name = collection ? segment.slice(0, -2) : segment;
      return `${escapeRegExp(name)}${collection ? "\\[\\d+\\]" : ""}`;
    })
    .join("\\.");
  return new RegExp(`^${pattern}\\.root$`).test(memberName);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function refComponentToolManifest(
  pomId: string,
  path: readonly PomComponentMemberManifest[],
  action: ToolManifest
): ToolManifest {
  const parameters = [
    {
      name: "ref",
      optional: false,
      schema: {
        type: "string",
        description:
          "Structural Ref of the instance's Page Object Root, as labelled in the page state.",
      } satisfies JsonSchema,
    },
    {
      name: "args",
      optional: false,
      schema: action.inputSchema,
    },
  ];

  return {
    ...action,
    toolName: `${pomId}.${publicComponentPath(path)}.${action.methodName}`,
    inputSchema: inputSchemaFor(parameters),
    parameters,
  };
}

function componentPathFor(path: readonly PomComponentMemberManifest[]) {
  return path
    .map((member) => `${member.memberName}${member.collection ? "[]" : ""}`)
    .join(".");
}

function publicComponentPath(path: readonly PomComponentMemberManifest[]) {
  return path.map((member) => member.memberName).join(".");
}

async function resolveSingularComponent(
  pageInstance: object,
  path: readonly PomComponentMemberManifest[]
) {
  let current: unknown = pageInstance;
  for (const member of path) {
    if (!isRecord(current)) return undefined;
    current = await readMember(current, member);
  }
  return current;
}

async function readMember(instance: object, member: PomMemberManifest) {
  const value = Reflect.get(instance, member.memberName);
  if (member.access === "method") {
    if (!isCallable(value))
      throw new RuntimeStateError(
        `POM member ${member.memberName} is not callable.`
      );
    return await value.apply(instance, []);
  }
  return await value;
}

function validatedArguments(tool: ToolManifest, args: unknown) {
  const input = asRecord(args);
  const knownParameterNames = new Set(
    tool.parameters.map((parameter) => parameter.name)
  );
  for (const name of Object.keys(input)) {
    if (!knownParameterNames.has(name))
      throw new ToolInputError(`Unexpected input property ${name}.`);
  }

  return tool.parameters.map((parameter) => {
    const value = input[parameter.name];
    if (value === undefined) {
      if (parameter.optional) return undefined;
      throw new ToolInputError(
        `Missing required input property ${parameter.name}.`
      );
    }
    validateValue(parameter.name, parameter.schema, value);
    return value;
  });
}

/** Package-internal: check one input value against its schema, or throw a ToolInputError naming it. */
export function validateValue(
  name: string,
  schema: JsonSchema,
  value: unknown
) {
  if (schema.type === "array") {
    if (!Array.isArray(value))
      throw new ToolInputError(`Input property ${name} must be an array.`);
    if (schema.items)
      value.forEach((item, index) =>
        validateValue(`${name}[${index}]`, schema.items!, item)
      );
    return;
  }
  if (schema.type === "object") {
    const object = asRecord(value);
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const propertyName of Object.keys(object)) {
        if (!properties[propertyName])
          throw new ToolInputError(
            `Input property ${name}.${propertyName} is not supported.`
          );
      }
    }
    for (const requiredProperty of schema.required ?? []) {
      if (object[requiredProperty] === undefined) {
        throw new ToolInputError(
          `Input property ${name}.${requiredProperty} is required.`
        );
      }
    }
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      const propertyValue = object[propertyName];
      if (propertyValue !== undefined)
        validateValue(`${name}.${propertyName}`, propertySchema, propertyValue);
    }
    return;
  }

  if (schema.type === "integer") {
    if (!Number.isInteger(value) || typeof value !== "number") {
      throw new ToolInputError(`Input property ${name} must be an integer.`);
    }
  } else if (schema.type && typeof value !== schema.type) {
    throw new ToolInputError(
      `Input property ${name} must be a ${schema.type}.`
    );
  }
  if (
    schema.minimum !== undefined &&
    (typeof value !== "number" || value < schema.minimum)
  ) {
    throw new ToolInputError(
      `Input property ${name} must be at least ${schema.minimum}.`
    );
  }
  if (
    schema.enum &&
    (!isJsonPrimitive(value) || !schema.enum.includes(value))
  ) {
    throw new ToolInputError(
      `Input property ${name} must be one of ${schema.enum.join(", ")}.`
    );
  }
}

function inputSchemaFor(
  parameters: readonly { name: string; optional: boolean; schema: JsonSchema }[]
): JsonSchema {
  const properties = Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.schema])
  );
  const required = parameters
    .filter((parameter) => !parameter.optional)
    .map((parameter) => parameter.name);
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function asComponents(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new RuntimeStateError("Expected a component collection array.");
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new ToolInputError("Tool input must be an object.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
