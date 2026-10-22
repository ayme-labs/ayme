import type { Locator } from "@playwright/test";
import type {
  PomManifest,
  PomMemberObservation,
  ToolManifest,
} from "../shared";
import { methodArguments } from "./actionTool";
import {
  assertAvailable,
  assertRootReachable,
  latestPageStateRef,
  onPageStateRecorded,
  providePageObjectStructure,
  refFailure,
  resolveRef,
  runAction,
  unavailableError,
  type ActionResult,
  type ToolAvailability,
} from "../page-state";
import { RefResolutionError, RuntimeStateError } from "../shared";
import {
  availabilityOf,
  combinedAvailability,
  type ObservedPomRoot,
  type PomInstanceObservation,
} from "./pomInstance";
import {
  pomGroups,
  type PageObjectObservation,
  type PomGroup,
  type PomTargetSource,
  type RegisteredPomTarget,
} from "./pomTree";
import { observePageObject, resolveTargets } from "./pomTreeWalk";
import {
  componentToolFacts,
  listedInstead,
  pageToolFacts,
  type ScopedPomTool,
} from "./pomTools";
import { sameNamedClassRefusal } from "./pomClasses";
import {
  newObservationErrors,
  pomLabel,
  sameObservation,
} from "./observationReport";
import { compiledManifestOf, type PageObjectConstructor } from "./compiledPoms";
import type { PageDriver, PageWatch } from "./pageDriver";
import type { Cursor } from "../page-state";
import type { RunContext } from "../runs";

/**
 * Package-internal: a Page Object tool as the registry holds it. Its
 * `execute` runs it for a Run, whose context carries the cursor its Change
 * Record reads from and moves.
 */
export type CallerAwarePomTool = ScopedPomTool & {
  execute(input: unknown, context: RunContext): Promise<ActionResult>;
};

export type RegisteredPom = {
  id: string;
  instance: object;
  manifest: PomManifest;
  memberObservations: readonly PomMemberObservation[];
  /**
   * The paths from the page of the Page Object instances the last
   * observation found on the page: "" for the page itself, "archiveDialog"
   * or "items[1]" for a child. Empty until the first observation.
   */
  presentPaths: ReadonlySet<string>;
  /**
   * The paths from the page of the locator members the last observation
   * found resolving to their Page Object's root element, e.g. "container"
   * or "items[1].element": each is the root, not a child, so it is left out
   * of the member observations. Empty until the first observation.
   */
  rootMemberPaths: ReadonlySet<string>;
  tools: readonly ScopedPomTool[];
};

export type RegisteredPomRoot = {
  label: string;
  element: Element;
};

/**
 * The instances the last observation found of one registered Page Object,
 * and the ones each of its tools stands for, by the tool's component path
 * ("" for the page's own tools).
 */
type InstanceObservations = {
  all: readonly PomInstanceObservation[];
  byComponentPath: ReadonlyMap<string, readonly PomInstanceObservation[]>;
};

type ObservedRegisteredPom = RegisteredPom & {
  pomClass: object;
  /**
   * Undefined until its first observation has run: a Page Object lists no
   * tools before then, so an agent is never told a tool's availability the
   * observation has not found yet (ADR-0035).
   */
  instances: InstanceObservations | undefined;
  /**
   * The paths of the collection members the last observation found holding
   * an item that declares no root, e.g. "owners" or "items[1].tags".
   */
  rootlessCollectionPaths: ReadonlySet<string>;
  /** The locators the last observation found its members and roots holding. */
  targetSources: readonly PomTargetSource[];
  tools: readonly CallerAwarePomTool[];
};

/**
 * A collection tool's item, labelled as the page state labels it, with
 * whether the tool would run on it now and why not.
 */
export type CollectionToolItem = RegisteredPomRoot & ToolAvailability;

/**
 * Package-internal: a registry of the Page Objects on one page, which it
 * reads through `driver` and watches while any is registered.
 */
export function createPomRegistry(driver: PageDriver) {
  const registeredPoms = new Set<ObservedRegisteredPom>();
  // Registrations refused for a same-named class, in the order they were
  // made: each gets in once the registration it clashes with is disposed.
  const waitingPoms = new Set<ObservedRegisteredPom>();
  const subscribers = new Set<() => void>();
  let pageWatch: PageWatch | undefined;
  let stopWatchingPageStates: (() => void) | undefined;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let probeLifetime = 0;
  let probeInFlight: Promise<void> | undefined;
  // Only read after runPomMemberProbe or stopObservingPage has set it.
  // Stryker disable next-line BooleanLiteral: equivalent, its first value is never read
  let probePending = false;

  /**
   * Package-internal: unregisters every Page Object, as a runtime session
   * starts or ends.
   */
  function resetRegisteredPoms() {
    const hadRegistrations = registeredPoms.size > 0;
    registeredPoms.clear();
    waitingPoms.clear();
    stopObservingPage();
    if (hadRegistrations) notifySubscribers();
  }

  function registerPageObject<T extends object>(
    PomClass: PageObjectConstructor<T>,
    instance: T
  ) {
    const compiledPom = compiledManifestOf(PomClass);
    const registration: ObservedRegisteredPom = {
      id: compiledPom.className,
      pomClass: PomClass,
      instance,
      manifest: compiledPom,
      memberObservations: [],
      presentPaths: new Set(),
      rootMemberPaths: new Set(),
      instances: undefined,
      rootlessCollectionPaths: new Set(),
      targetSources: [],
      tools: [],
    };
    // Its collection tools read the instances observed of this registration.
    registration.tools = createRegisteredTools(driver, registration);
    // A clash between the app's own classes is logged rather than thrown, so
    // it does not take down the component, or the session start, that
    // registered the Page Object. It lists no tools until the clash is gone.
    const refusal = sameNamedClassRefusal(
      [...registeredPoms],
      PomClass,
      compiledPom
    );
    if (refusal) {
      console.error(refusal);
      waitingPoms.add(registration);
    } else {
      admitRegisteredPom(registration);
      notifySubscribers();
    }

    return {
      instance,
      dispose() {
        if (waitingPoms.delete(registration)) return;
        if (!registeredPoms.delete(registration)) return;
        if (registeredPoms.size === 0) stopObservingPage();
        // Only leaving can clear a clash. A registration still refused is
        // not logged again.
        for (const waiting of waitingPoms)
          if (
            !sameNamedClassRefusal(
              [...registeredPoms],
              waiting.pomClass,
              waiting.manifest
            )
          ) {
            waitingPoms.delete(waiting);
            admitRegisteredPom(waiting);
          }
        notifySubscribers();
      },
    };
  }

  function admitRegisteredPom(registration: ObservedRegisteredPom) {
    const registryWasEmpty = registeredPoms.size === 0;
    registeredPoms.add(registration);
    if (registryWasEmpty) startObservingPage();
    else schedulePomMemberProbe();
  }

  function startObservingPage() {
    pageWatch = driver.watch(schedulePomMemberProbe);
    // An Availability Reason names the ref a recorded page state may have
    // just given the element in the way, so the tools are read again.
    stopWatchingPageStates = onPageStateRecorded(
      document,
      announceObstructedRoots
    );
    providePageObjectStructure(getRegisteredPomStructure);
    schedulePomMemberProbe();
  }

  function stopObservingPage() {
    probeLifetime += 1;
    probeInFlight = undefined;
    probePending = false;
    pageWatch?.stop();
    pageWatch = undefined;
    stopWatchingPageStates?.();
    stopWatchingPageStates = undefined;
    providePageObjectStructure(undefined);
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    probeTimer = undefined;
  }

  function schedulePomMemberProbe() {
    probePending = true;
    if (probeInFlight || probeTimer !== undefined) return;
    probeTimer = setTimeout(() => {
      probeTimer = undefined;
      void runPomMemberProbe().catch(() => {});
    }, 0);
  }

  async function probeRegisteredPomMembers(): Promise<void> {
    const lifetime = probeLifetime;
    await runPomMemberProbe();
    // Await at most one follow-up. A live page need not become quiet to be
    // read.
    if (lifetime === probeLifetime && probePending) await runPomMemberProbe();
  }

  function runPomMemberProbe(): Promise<void> {
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
        if (probePending) schedulePomMemberProbe();
      });
    return probeInFlight;
  }

  async function probeRegistrations(lifetime: number): Promise<void> {
    if (lifetime !== probeLifetime) return;
    // Each Page Object's observation is committed as it completes, so one
    // that is slow to read does not hold back the others' tools. The probe
    // ends only once every observation has, even when a subscriber throws,
    // so a later probe's observation is never overwritten by an older one.
    const settled = await Promise.allSettled(
      [...registeredPoms].map(async (registration) => {
        const observed = await observePageObject(
          driver,
          registration.instance,
          registration.manifest
        );
        if (
          lifetime === probeLifetime &&
          commitObservation(registration, observed)
        )
          notifySubscribers();
      })
    );
    const failed = settled.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  /**
   * Keeps `registration`'s new observation, so a call acts on the instances
   * the last observation read, and logs what it found wrong that the last
   * one did not; whether it found anything new.
   */
  function commitObservation(
    registration: ObservedRegisteredPom,
    observation: PageObjectObservation
  ): boolean {
    if (!registeredPoms.has(registration)) return false;
    const last = {
      instances: registration.instances?.all,
      memberObservations: registration.memberObservations,
      rootlessCollectionPaths: registration.rootlessCollectionPaths,
    };
    for (const error of newObservationErrors(
      registration.id,
      last,
      observation
    ))
      console.error(error);
    const same = sameObservation(last, observation);
    const { memberObservations, instances, rootMemberPaths, targetSources } =
      observation;
    registration.memberObservations = memberObservations;
    registration.presentPaths = new Set(
      instances.flatMap((instance) => (instance.present ? [instance.path] : []))
    );
    registration.rootMemberPaths = rootMemberPaths;
    registration.rootlessCollectionPaths = new Set(
      observation.rootlessCollections.keys()
    );
    registration.targetSources = targetSources;
    registration.instances = groupedInstances(instances);
    return !same;
  }

  function listRegisteredPoms(): RegisteredPom[] {
    return [...registeredPoms];
  }

  async function listRegisteredPomRoots(): Promise<RegisteredPomRoot[]> {
    return (await getRegisteredPomStructure()).roots;
  }

  // Capture labels and exclusions from the same completed observation. A
  // present Page Object's root is labelled; a root that is not on the page
  // is left out of the capture, while one whose Page Object a predicate
  // withdrew is unlabelled rendered content.
  async function getRegisteredPomStructure() {
    await probeRegisteredPomMembers();
    const observations = [...registeredPoms].flatMap((registration) =>
      (registration.instances?.all ?? []).flatMap(({ path, root, present }) =>
        root ? [{ root, present, label: pomLabel(registration.id, path) }] : []
      )
    );
    const roots = observations.flatMap(({ root, present, label }) =>
      present && isRootPresent(root) ? [{ label, element: root.element }] : []
    );
    const labelled = new Set(roots.map((root) => root.element));
    const absentElements = [
      ...new Set(
        observations.flatMap(({ root }) =>
          !root.present &&
          root.element?.isConnected &&
          !labelled.has(root.element)
            ? [root.element]
            : []
        )
      ),
    ];
    return { roots, absentElements };
  }

  /**
   * Package-internal: every element the registered Page Objects' members
   * hold now, one target per element and concrete member path, in
   * registration and declaration order. The latest observation says which
   * locators those are, and each read resolves them again, so a change no
   * observation follows, such as a checked box or a focus move, shows too.
   * An observation runs first only when the page changed since the last
   * one, so a reader called on every render does not walk the tree again.
   * Paths through collections carry their item indices.
   */
  async function listRegisteredPomTargets(): Promise<RegisteredPomTarget[]> {
    pageWatch?.flush();
    if (probePending || probeInFlight) await probeRegisteredPomMembers();
    return resolveTargets(
      driver,
      [...registeredPoms].flatMap((registration) => registration.targetSources)
    );
  }

  /**
   * Package-internal: every registered Page Object tool, one per name, with
   * whether it is present, available now, and why not (ADR-0035). A tool is
   * present while its Page Object, or the component instance it acts on,
   * is; available while that Page Object is available and the action's
   * predicate, if it has one, holds. A collection action stands for every
   * present instance: it is available while any instance is, and when none
   * is, its reason is the first present instance's. Of tools sharing a
   * name, the first available one wins, else the first present, else the
   * first registered.
   */
  function listRegisteredPomTools(): ({
    tool: CallerAwarePomTool;
  } & ToolAvailability)[] {
    const tools = new Map<
      string,
      { tool: CallerAwarePomTool } & ToolAvailability
    >();
    for (const registration of registeredPoms)
      for (const tool of registration.tools) {
        const availability = combinedAvailability(
          instancesOf(registration, tool).map((instance) =>
            availabilityNow(instance, tool.methodName)
          )
        );
        if (listedInstead(availability, tools.get(tool.name)))
          tools.set(tool.name, { tool, ...availability });
      }
    return [...tools.values()];
  }

  /**
   * Package-internal: the available Page Object tools, the ones a call can
   * run now, with the run that takes a caller.
   */
  function listAvailablePomTools(): CallerAwarePomTool[] {
    return listRegisteredPomTools().flatMap(({ tool, available }) =>
      available ? [tool] : []
    );
  }

  /**
   * Package-internal: the present items each tool that goes through a
   * collection acts on, by tool name, labelled as the page state labels
   * them, each with whether the tool would run on it now and why not. A
   * tool whose path holds no collection is absent from the map.
   */
  function listCollectionToolItems(): Map<string, CollectionToolItem[]> {
    const itemsByTool = new Map<string, CollectionToolItem[]>();
    for (const registration of registeredPoms) {
      for (const tool of registration.tools) {
        if (tool.collectionPath === undefined) continue;
        itemsByTool.set(tool.name, [
          ...(itemsByTool.get(tool.name) ?? []),
          ...collectionItemsOf(registration, tool),
        ]);
      }
    }
    return itemsByTool;
  }

  function subscribeToRegisteredPoms(subscriber: () => void) {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  }

  function notifySubscribers() {
    for (const subscriber of subscribers) subscriber();
  }

  /**
   * Tells the subscribers to read the tools again although no observation
   * changed, as when a recorded page state gave the element in an
   * unavailable root's way its ref.
   */
  function announceObstructedRoots() {
    const obstructed = [...registeredPoms].some((registration) =>
      registration.instances?.all.some(
        (instance) => instance.root?.inTheWay.length
      )
    );
    if (obstructed) notifySubscribers();
  }

  return {
    getRegisteredPomStructure,
    listAvailablePomTools,
    listCollectionToolItems,
    listRegisteredPomRoots,
    listRegisteredPomTargets,
    listRegisteredPomTools,
    listRegisteredPoms,
    probeRegisteredPomMembers,
    registerPageObject,
    resetRegisteredPoms,
    subscribeToRegisteredPoms,
  };
}

function groupedInstances(
  all: readonly PomInstanceObservation[]
): InstanceObservations {
  const byComponentPath = new Map<string, PomInstanceObservation[]>();
  for (const instance of all) {
    const key = instance.componentPath ?? "";
    const group = byComponentPath.get(key);
    if (group) group.push(instance);
    else byComponentPath.set(key, [instance]);
  }
  return { all, byComponentPath };
}

/** The instances `tool` of `registration` stands for, as last observed. */
function instancesOf(
  registration: ObservedRegisteredPom,
  tool: ScopedPomTool
): readonly PomInstanceObservation[] {
  return (
    registration.instances?.byComponentPath.get(tool.componentPath ?? "") ?? []
  );
}

function isRootPresent<T extends ObservedPomRoot>(
  root: T
): root is T & { element: Element } {
  return root.present && root.element?.isConnected === true;
}

/**
 * `instance`'s availability for `methodName` now. An observation whose root
 * element has since left the page is stale: the instance reads as absent
 * until the next probe observes it again, so no call runs on it.
 */
function availabilityNow(
  instance: PomInstanceObservation,
  methodName: string
): ToolAvailability {
  if (instance.root?.element?.isConnected === false)
    return { present: false, available: false };
  return availabilityOf(instance, methodName, latestPageStateRef);
}

/**
 * The present items `tool` of `registration` goes through, as last observed,
 * each with the tool's verdict on it: what the Goal Loop offers and what a
 * call on an item is refused by.
 */
function collectionItemsOf(
  registration: ObservedRegisteredPom,
  tool: ScopedPomTool
): CollectionToolItem[] {
  return instancesOf(registration, tool).flatMap((instance) => {
    const root = instance.item?.root;
    return instance.item?.present && root && isRootPresent(root)
      ? [
          {
            label: `${registration.id}.${instance.item.path}`,
            element: root.element,
            ...availabilityNow(instance, tool.methodName),
          },
        ]
      : [];
  });
}

function createRegisteredTools(
  driver: PageDriver,
  registration: ObservedRegisteredPom
) {
  const { id, manifest } = registration;
  const pageTools = manifest.tools.map((action) =>
    createTool(driver, registration, pageToolFacts(id, action), action)
  );
  const componentTools = pomGroups(manifest).flatMap((group) =>
    group.component.tools.map((action) =>
      group.collectionKey === undefined
        ? createTool(
            driver,
            registration,
            componentToolFacts(id, group, action),
            action
          )
        : createCollectionTool(driver, registration, group, action)
    )
  );
  return [...pageTools, ...componentTools];
}

/** A tool that acts on the one instance the last observation found. */
function createTool(
  driver: PageDriver,
  registration: ObservedRegisteredPom,
  facts: ScopedPomTool,
  action: ToolManifest
): CallerAwarePomTool {
  const tool: CallerAwarePomTool = {
    ...facts,
    execute: async (args, { cursor }) =>
      performPageObjectAction(
        callTarget(driver, tool.name, instancesOf(registration, tool)[0]),
        action,
        args,
        cursor
      ),
  };
  return tool;
}

/** What a call acts on: an instance the last observation read, and its root. */
type CallTarget = { instance: object; root: Locator | undefined };

/**
 * The target of a call of the tool `toolName` on `observed`, as the last
 * observation read it: the call runs no root predicate of its own. Refused
 * when the observation found no instance, or its root, or the root of the
 * collection item it lies in, has since left the page or resolves to
 * another element: a root-less child acts through its item, whose locator
 * may since address another item.
 */
function callTarget(
  driver: PageDriver,
  toolName: string,
  observed: PomInstanceObservation | undefined
): CallTarget {
  if (
    !observed ||
    !rootHolds(driver, observed) ||
    (observed.item !== undefined &&
      observed.item !== observed &&
      !rootHolds(driver, observed.item))
  )
    throw unavailableError(toolName, { present: false });
  return { instance: observed.instance, root: observed.rootLocator };
}

/**
 * Whether the root the observation found `observed` at is still its root:
 * a root-less instance has none to lose; a rooted one keeps it while its
 * locator still resolves to that one element.
 */
function rootHolds(
  driver: PageDriver,
  observed: PomInstanceObservation
): boolean {
  if (observed.rootLocator === undefined) return observed.root === undefined;
  const element = observed.root?.element;
  if (!element?.isConnected) return false;
  const elements = driver.elementsOf(observed.rootLocator);
  return elements.length === 1 && elements[0] === element;
}

/** A tool that acts on the collection item its ref names. */
function createCollectionTool(
  driver: PageDriver,
  registration: ObservedRegisteredPom,
  group: PomGroup,
  action: ToolManifest
): CallerAwarePomTool {
  const execute: CallerAwarePomTool["execute"] = async (input, { cursor }) => {
    const { ref, args = {} } = input as { ref: string; args?: object };
    const toolPath = `${registration.id}.${group.toolPath}`;
    const label = `call ${tool.name} on`;
    const { element } = await resolveRef(ref, label, document);
    // The instance the last observation found at the ref's element; an item
    // it did not find is not on the page yet.
    const observed = instancesOf(registration, tool).find(
      (instance) => instance.item?.root?.element === element
    );
    if (!observed) {
      throw new RefResolutionError(
        refFailure(
          label,
          ref,
          `it is not an instance of ${group.component.className} at ${toolPath}`
        )
      );
    }
    const item = collectionItemsOf(registration, tool).find(
      (candidate) => candidate.element === element
    );
    assertAvailable(tool.name, item ?? { present: false, available: false });
    return await performPageObjectAction(
      callTarget(driver, tool.name, observed),
      action,
      args,
      cursor
    );
  };
  const tool: CallerAwarePomTool = {
    ...componentToolFacts(registration.id, group, action),
    execute,
  };
  return tool;
}

/**
 * Performs a Page Object Action on `target` for a Run whose Change Record is
 * read from `cursor`. With a root, the instance's Page Object Root, the call
 * is refused first when a click would not reach the root where the action
 * would find it (ADR-0041), as the observation that listed the tool could
 * not tell for a root it had to scroll to.
 */
async function performPageObjectAction(
  { instance, root }: CallTarget,
  tool: ToolManifest,
  args: unknown,
  cursor: Cursor
): Promise<ActionResult> {
  const method = Reflect.get(instance, tool.methodName);
  if (!isCallable(method))
    throw new RuntimeStateError(
      `POM method ${tool.methodName} is not callable.`
    );

  const currentDocument = requireCurrentDocument();
  const parameters = methodArguments(
    tool.parameters,
    argumentValues(tool, args)
  );
  if (root) await assertRootReachable(tool.toolName, root);
  // A tool may be called without the Caller ever having read the page; the
  // Change Record then starts from the page right before the action.
  return runAction(currentDocument, cursor, { tool: tool.toolName, args }, () =>
    method.apply(instance, parameters)
  );
}

function requireCurrentDocument(): Document {
  if (typeof document === "undefined")
    throw new RuntimeStateError(
      "POM tool execution requires a browser Document."
    );
  return document;
}

/** The values of `tool`'s parameters in `args`, input the runtime checked. */
function argumentValues(tool: ToolManifest, args: unknown) {
  const input = args as Record<string, unknown>;
  // An inherited name, such as constructor, is no argument.
  return tool.parameters.map((parameter) =>
    Object.hasOwn(input, parameter.name) ? input[parameter.name] : undefined
  );
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}
