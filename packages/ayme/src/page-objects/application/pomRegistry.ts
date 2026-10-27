import type { Locator } from "@playwright/test";
import type {
  PomComponentManifest,
  PomManifest,
  PomMemberObservation,
  ToolManifest,
  RegisteredPomTool,
} from "../../shared";
import { modelOption } from "../domain/decorators";
import { methodArguments } from "../domain/actionTool";
import {
  assertAvailable,
  assertRootReachable,
  providePageObjectStructure,
  refFailure,
  unavailableError,
  type ActionResult,
  type ToolAvailability,
} from "../../page-state";
import { RefResolutionError, RuntimeStateError } from "../../shared";
import {
  availabilityOf,
  combinedAvailability,
  type ObservedPomRoot,
  type PomInstanceObservation,
} from "../domain/pomInstance";
import {
  componentsOf,
  type PageObjectObservation,
  type PomTargetSource,
  type RegisteredPomTarget,
} from "../domain/pomTree";
import { observePageObject, resolveTargets } from "./pomTreeWalk";
import { pomToolFacts } from "../domain/pomTools";
import {
  rootlessClassRefusals,
  sameNamedClassRefusal,
} from "../domain/pomClasses";
import {
  newObservationErrors,
  sameObservation,
} from "../domain/observationReport";
import {
  compiledRootDeclared,
  compiledManifestOf,
  type PageObjectConstructor,
} from "./compiledPoms";
import type { PageDriver, PageWatch } from "./pageDriver";
import type { RunContext } from "../../runs";

/**
 * Package-internal: a Page Object tool as the registry holds it. Its
 * `execute` runs it for a Run, whose context carries the cursor its Change
 * Record reads from and moves.
 */
export type CallerAwarePomTool = RegisteredPomTool & {
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
  tools: readonly RegisteredPomTool[];
};

export type RegisteredPomRoot = {
  label: string;
  element: Element;
};

type ObservedRegisteredPom = Omit<RegisteredPom, "tools"> & {
  pomClass: object;
  /**
   * Undefined until its first observation has run: a Page Object lists no
   * tools before then, so an agent is never told a tool's availability the
   * observation has not found yet (ADR-0035).
   */
  instances: readonly PomInstanceObservation[] | undefined;
  /** The locators the last observation found its members and roots holding. */
  targetSources: readonly PomTargetSource[];
  tools: readonly CallerAwarePomTool[];
};

/** A rooted tool's instance, whether the tool would run on it and why not. */
export type RootedToolInstance = { element: Element } & ToolAvailability;

/**
 * Package-internal: a registry of the Page Objects on one page, which it
 * reads through `driver` and watches while any is registered.
 */
export function createPomRegistry(driver: PageDriver) {
  const registeredPoms = new Set<ObservedRegisteredPom>();
  // Registrations refused for a same-named class, in the order they were
  // made: each gets in once the registration it clashes with is disposed.
  const waitingPoms = new Set<ObservedRegisteredPom>();
  let refusedClasses = new Map<string, RuntimeStateError>();
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
    refusedClasses.clear();
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
      targetSources: [],
      tools: [],
    };
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
        refreshRootlessRefusals();
        refreshRegisteredTools();
        notifySubscribers();
      },
    };
  }

  function admitRegisteredPom(registration: ObservedRegisteredPom) {
    const registryWasEmpty = registeredPoms.size === 0;
    registeredPoms.add(registration);
    refreshRootlessRefusals();
    refreshRegisteredTools();
    if (registryWasEmpty) startObservingPage();
    else schedulePomMemberProbe();
  }

  function refreshRootlessRefusals() {
    const manifests = [...registeredPoms].map(({ manifest }) => manifest);
    const roots = new Map(
      manifests.flatMap((manifest) =>
        [manifest, ...manifest.components].map(
          (node) => [node.className, compiledRootDeclared(node)] as const
        )
      )
    );
    const next = rootlessClassRefusals(manifests, (className) =>
      roots.get(className)
    );
    for (const [className, error] of next)
      if (refusedClasses.get(className)?.message !== error.message)
        console.error(error);
    refusedClasses = next;
  }

  function startObservingPage() {
    pageWatch = driver.watch(schedulePomMemberProbe);
    // An Availability Reason names the ref a recorded page state may have
    // just given the element in the way, so the tools are read again.
    stopWatchingPageStates = driver.onPageStateRecorded(
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
      instances: registration.instances,
      memberObservations: registration.memberObservations,
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
    registration.targetSources = targetSources;
    registration.instances = instances;
    refreshRegisteredTools();
    return !same;
  }

  function refreshRegisteredTools() {
    const classes = new Map<
      string,
      {
        component: PomComponentManifest;
        owner: ObservedRegisteredPom;
        actions: Map<string, ToolManifest>;
      }
    >();
    for (const registration of registeredPoms) {
      registration.tools = [];
      for (const component of reachableClasses(registration.manifest)) {
        let entry = classes.get(component.className);
        if (!entry) {
          entry = { component, owner: registration, actions: new Map() };
          classes.set(component.className, entry);
        }
        // HMR can leave two versions registered until their pages remount.
        for (const action of component.tools)
          entry.actions.set(action.toolName, action);
      }
    }
    for (const { component, owner, actions } of classes.values()) {
      const instance = instancesOf(component)[0]?.instance;
      const rooted =
        compiledRootDeclared(component) ??
        (instance !== undefined &&
          modelOption(instance.constructor, "root") !== undefined);
      owner.tools = owner.tools.concat(
        [...actions.values()].map((action) =>
          createTool(
            driver,
            pomToolFacts(component.className, rooted, action),
            action,
            instancesOf
          )
        )
      );
    }
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
      (registration.instances ?? []).flatMap(({ className, root, present }) =>
        root ? [{ root, present, label: className }] : []
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

  /** Each distinct root of the tool's class, across all registrations. */
  function instancesOf(
    tool: Pick<RegisteredPomTool, "className">
  ): readonly PomInstanceObservation[] {
    const instances: PomInstanceObservation[] = [];
    const roots = new Set<Element>();
    for (const registration of registeredPoms)
      for (const instance of registration.instances ?? []) {
        if (instance.className !== tool.className) continue;
        const element = instance.root?.element;
        if (element && roots.has(element)) continue;
        if (element) roots.add(element);
        instances.push(instance);
      }
    return instances;
  }

  /**
   * Package-internal: every registered Page Object tool, one per name, with
   * whether it is present, available now, and why not (ADR-0035). A tool is
   * present while its Page Object, or the component instance it acts on,
   * is; available while that Page Object is available and the action's
   * predicate, if it has one, holds. A rooted action stands for every
   * present instance: it is available while any instance is, and when none
   * is, its reason is the first present instance's.
   */
  function listRegisteredPomTools(): ({
    tool: CallerAwarePomTool;
  } & ToolAvailability)[] {
    return [...registeredPoms]
      .flatMap(({ tools }) => tools)
      .filter((tool) => !refusedClasses.has(tool.className))
      .map((tool) => ({
        tool,
        ...combinedAvailability(
          instancesOf(tool).map((instance) =>
            availabilityNow(driver, instance, tool.methodName)
          )
        ),
      }));
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
   * Package-internal: the present instances each rooted tool acts on, by
   * tool name, labelled as the page state labels them, each with whether
   * the tool would run on it now and why not. Root-less tools have no items.
   */
  function listRootedToolInstances(): Map<string, RootedToolInstance[]> {
    const itemsByTool = new Map<string, RootedToolInstance[]>();
    for (const { tool } of listRegisteredPomTools())
      if (tool.rooted)
        itemsByTool.set(
          tool.name,
          rootedInstancesOf(driver, instancesOf(tool), tool)
        );
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
      registration.instances?.some((instance) => instance.root?.inTheWay.length)
    );
    if (obstructed) notifySubscribers();
  }

  return {
    getRegisteredPomStructure,
    listAvailablePomTools,
    listRootedToolInstances,
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
  driver: PageDriver,
  instance: PomInstanceObservation,
  methodName: string
): ToolAvailability {
  if (instance.root?.element?.isConnected === false)
    return { present: false, available: false };
  return availabilityOf(instance, methodName, driver.latestPageStateRef);
}

/**
 * The present items `tool` of `registration` goes through, as last observed,
 * each with the tool's verdict on it: what the Goal Loop offers and what a
 * call on an item is refused by.
 */
function rootedInstancesOf(
  driver: PageDriver,
  instances: readonly PomInstanceObservation[],
  tool: RegisteredPomTool
): RootedToolInstance[] {
  return instances.flatMap((instance) => {
    const root = instance.root;
    return instance.present && root && isRootPresent(root)
      ? [
          {
            element: root.element,
            ...availabilityNow(driver, instance, tool.methodName),
          },
        ]
      : [];
  });
}

function reachableClasses(manifest: PomManifest) {
  // Only member edges publish tools. Action return types alone create no instance.
  const components = componentsOf(manifest);
  const classes = new Map<string, PomComponentManifest>([
    [manifest.className, manifest],
  ]);
  const visit = (component: PomComponentManifest) => {
    for (const member of component.members) {
      if (member.kind !== "component" || classes.has(member.componentClassName))
        continue;
      const child = components.get(member.componentClassName);
      if (!child) continue;
      classes.set(child.className, child);
      visit(child);
    }
  };
  visit(manifest);
  return classes.values();
}

/** Runs a rooted instance by ref, or the sole root-less instance directly. */
function createTool(
  driver: PageDriver,
  facts: RegisteredPomTool,
  action: ToolManifest,
  instancesOf: (tool: RegisteredPomTool) => readonly PomInstanceObservation[]
): CallerAwarePomTool {
  const tool: CallerAwarePomTool = {
    ...facts,
    execute: async (input, context) => {
      let args = input;
      let targetName = tool.name;
      const instances = instancesOf(tool);
      let observed: PomInstanceObservation | undefined = instances[0];
      if (tool.rooted) {
        const { ref, args: actionArgs = {} } = input as {
          ref: string;
          args?: object;
        };
        args = actionArgs;
        const label = `call ${tool.name} on`;
        const { element } = await context.pageStateSession.resolveRef(
          ref,
          label
        );
        const previous = instances.find(
          (instance) => instance.root?.element === element
        );
        observed = instancesOf(tool).find(
          (instance) => instance.root?.element === element
        );
        // Ref resolution captures the page and may observe a replacement
        // model. Keep the pre-call verdict only for the same live instance.
        if (previous && (!observed || previous.instance === observed.instance))
          observed = previous;
        if (!observed)
          throw new RefResolutionError(
            refFailure(label, ref, `it is not a root of ${tool.className}`)
          );
        targetName = `${tool.className} on ref "${ref}"`;
        assertAvailable(
          targetName,
          availabilityNow(driver, observed, tool.methodName)
        );
      }
      const target = callTarget(driver, targetName, observed);
      return performPageObjectAction(target, action, args, context, targetName);
    },
  };
  return tool;
}

/**
 * What a call of a Page Object Tool acts on: the live instance and, for a
 * rooted one, its root as the page driver resolves the root's locator now,
 * one element.
 */
type CallTarget = {
  instance: object;
  root: { locator: Locator; element: Element } | undefined;
};

/**
 * The target of a call of the tool `toolName` on `observed`, as the last
 * observation read it: the call runs no root predicate of its own. Refused
 * when the observation found no instance, or its own root has since left
 * the page or resolves to another element.
 */
function callTarget(
  driver: PageDriver,
  toolName: string,
  observed: PomInstanceObservation | undefined
): CallTarget {
  const root = observed && heldRoot(driver, observed);
  if (!observed || root === false)
    throw unavailableError(toolName, { present: false });
  return { instance: observed.instance, root };
}

/**
 * The root the observation found `observed` at, while it is still its
 * root: a root-less instance has none to lose (undefined); a rooted one
 * keeps it while the page driver resolves its locator to that one element.
 * false once it is lost.
 */
function heldRoot(
  driver: PageDriver,
  observed: PomInstanceObservation
): CallTarget["root"] | false {
  if (observed.rootLocator === undefined)
    return observed.root === undefined ? undefined : false;
  const element = observed.root?.element;
  if (!element?.isConnected) return false;
  const elements = driver.elementsOf(observed.rootLocator);
  return elements.length === 1 && elements[0] === element
    ? { locator: observed.rootLocator, element }
    : false;
}

/**
 * Performs a Page Object Action for a Run, on its Document, whose Change
 * Record reads from its cursor. With a root, checks whether a click would
 * reach the root where the action would find it, as the Run's Reach
 * measures it (ADR-0041): the observation that listed the tool could not
 * tell for a root it had to scroll to.
 */
async function performPageObjectAction(
  { instance, root }: CallTarget,
  tool: ToolManifest,
  args: unknown,
  { cursor, pageStateSession, reach }: RunContext,
  targetName: string
): Promise<ActionResult> {
  const method = Reflect.get(instance, tool.methodName);
  if (!isCallable(method))
    throw new RuntimeStateError(
      `POM method ${tool.methodName} is not callable.`
    );

  const parameters = methodArguments(
    tool.parameters,
    argumentValues(tool, args)
  );
  if (root)
    await assertRootReachable(reach, targetName, root.locator, root.element);
  // A tool may be called without the Caller ever having read the page; the
  // Change Record then starts from the page right before the action.
  return pageStateSession.runAction(cursor, { tool: tool.toolName, args }, () =>
    method.apply(instance, parameters)
  );
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
