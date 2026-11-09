import type { Locator } from "@playwright/test";
import type {
  PomComponentManifest,
  PomManifest,
  PomMemberObservation,
  ToolManifest,
  RegisteredPomTool,
} from "../../shared";
import { modelOption } from "../domain/decorators";
import { methodArguments, patternViolations } from "../domain/actionTool";
import {
  assertAvailable,
  refFailure,
  unavailableError,
  type ActionResult,
  type ToolAvailability,
} from "../../page-state/domain";
import { assertLocatorReachable } from "../../page-state/infrastructure";
import {
  RefResolutionError,
  refuseViolations,
  RuntimeStateError,
} from "../../shared";
import {
  availabilityOf,
  combinedAvailability,
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
import type { PageDriver } from "./pageDriver";
import {
  createInstanceRefs,
  isInstanceRef,
  readPomScreen,
  type InstanceRefs,
} from "./pomScreen";
import type { ScreenObject } from "../domain/pomScreenText";
import type { RunContext } from "../../runs/application";

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
  mark: string;
  /** The Structural Ref the root's element has now. */
  ref: string;
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

/**
 * A rooted tool's instance, whether the tool would run on it and why not:
 * `ref` is the Structural Ref its root's element has now.
 */
export type RootedToolInstance = { ref: string } & ToolAvailability;

/**
 * What a runtime session adds to the registry of its page, which reads the
 * page by Structural Ref and Locator alone: how it hears of the session's
 * page states and tells its captures to wait for the probe.
 */
export type PomPageStates = {
  /**
   * Calls `listener` each time a page state is recorded, until the returned
   * function is called.
   */
  onPageStateRecorded(listener: () => void): () => void;
  /**
   * What the page's captures wait for before they read it, set while the
   * registry observes it; cleared when it stops.
   */
  providePageObjectProbe(probe: (() => Promise<void>) | undefined): void;
};

const noPageStates: PomPageStates = {
  onPageStateRecorded: () => () => {},
  providePageObjectProbe: () => {},
};

/**
 * Package-internal: a registry of the Page Objects on one page, which it
 * reads through `driver` and watches while any is registered.
 */
export function createPomRegistry(
  driver: PageDriver,
  pageStates: PomPageStates = noPageStates
) {
  const registeredPoms = new Set<ObservedRegisteredPom>();
  // Registrations refused for a same-named class, in the order they were
  // made: each gets in once the registration it clashes with is disposed.
  const waitingPoms = new Set<ObservedRegisteredPom>();
  let refusedClasses = new Map<string, RuntimeStateError>();
  const subscribers = new Set<() => void>();
  let stopWatchingPage: (() => void) | undefined;
  // The Instance Refs of this page's Page Object instances.
  const instanceRefs = createInstanceRefs(driver);
  let stopWatchingPageStates: (() => void) | undefined;

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
    else driver.refresh();
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
    stopWatchingPage = driver.watch(probeRegistrations);
    // An Availability Reason names the ref a recorded page state may have
    // just given the element in the way, so the tools are read again.
    stopWatchingPageStates = pageStates.onPageStateRecorded(
      announceObstructedRoots
    );
    // A capture waits for the roots of a completed probe run.
    pageStates.providePageObjectProbe(probeRegisteredPomMembers);
  }

  function stopObservingPage() {
    stopWatchingPage?.();
    stopWatchingPage = undefined;
    stopWatchingPageStates?.();
    stopWatchingPageStates = undefined;
    pageStates.providePageObjectProbe(undefined);
  }

  /**
   * Package-internal: a probe run that began after this call, and the one in
   * progress before it: a page that never rests is read after at most one
   * more. A Page Object reads more than the page, so this probes although the
   * page has not changed.
   */
  function probeRegisteredPomMembers(): Promise<void> {
    driver.refresh();
    return driver.probed();
  }

  async function probeRegistrations(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
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
        if (!signal.aborted && commitObservation(registration, observed))
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
            instancesOf,
            instanceRefs
          )
        )
      );
    }
  }

  function listRegisteredPoms(): RegisteredPom[] {
    return [...registeredPoms];
  }

  /**
   * Each present Page Object Root the registered Page Objects found, with
   * the mark its Page Object gives it and the Structural Ref its element has
   * now. A root that is not on the page has none.
   */
  async function listRegisteredPomRoots(): Promise<RegisteredPomRoot[]> {
    await probeRegisteredPomMembers();
    const found = [...registeredPoms].flatMap((registration) =>
      (registration.instances ?? []).flatMap(({ className, root, present }) =>
        present && root?.present && root.ref
          ? [{ mark: className, ref: root.ref }]
          : []
      )
    );
    const current = await driver.currentRefs(found.map(({ ref }) => ref));
    return found.flatMap(({ mark }, index) =>
      current[index] ? [{ mark, ref: current[index]! }] : []
    );
  }

  /**
   * Package-internal: every element the registered Page Objects' members
   * hold now, as its Structural Ref, one target per element and concrete
   * member path, in
   * registration and declaration order. The latest observation says which
   * locators those are, and each read resolves them again, so a change no
   * observation follows, such as a checked box or a focus move, shows too.
   * An observation runs first only when the page changed since the last
   * one, so a reader called on every render does not walk the tree again.
   * Paths through collections carry their item indices.
   */
  async function listRegisteredPomTargets(): Promise<RegisteredPomTarget[]> {
    await driver.probed();
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
    const roots = new Set<string>();
    for (const registration of registeredPoms)
      for (const instance of registration.instances ?? []) {
        if (instance.className !== tool.className) continue;
        const ref = instance.root?.ref;
        if (ref && roots.has(ref)) continue;
        if (ref) roots.add(ref);
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
   * tool name, marked as the page state marks them, each with whether
   * the tool would run on it now and why not. Root-less tools have no items.
   * Reads the page once the probe the page's changes made due has run, and
   * names each root by the ref its element has now.
   */
  async function listRootedToolInstances(): Promise<
    Map<string, RootedToolInstance[]>
  > {
    await driver.probed();
    const rooted = listRegisteredPomTools().flatMap(({ tool }) =>
      tool.rooted
        ? [
            {
              tool,
              instances: rootedInstancesOf(driver, instancesOf(tool), tool),
            },
          ]
        : []
    );
    const current = await driver.currentRefs(
      rooted.flatMap(({ instances }) => instances.map(({ ref }) => ref))
    );
    let next = 0;
    return new Map(
      rooted.map(({ tool, instances }) => [
        tool.name,
        instances.flatMap((instance) => {
          const ref = current[next++];
          return ref ? [{ ...instance, ref }] : [];
        }),
      ])
    );
  }

  /**
   * Package-internal: the Page Object Screen once the probe the page's
   * changes made due has run: every present instance, those rooted tools act
   * on with their Instance Refs.
   */
  async function readRegisteredPomScreen(): Promise<ScreenObject[]> {
    await probeRegisteredPomMembers();
    const rootedClasses = new Set(
      listRegisteredPomTools().flatMap(({ tool }) =>
        tool.rooted ? [tool.className] : []
      )
    );
    return readPomScreen(
      driver,
      [...registeredPoms],
      rootedClasses,
      instanceRefs
    );
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

  // The one runtime session that owns this registry.
  let owner: object | undefined;

  /**
   * Package-internal: makes the caller the registry's owner, with no Page
   * Object registered; the function it returns releases it. Throws while
   * another session owns it.
   */
  function claim(): () => void {
    if (owner)
      throw new RuntimeStateError(
        "The Ayme runtime already has an active owner.",
        { code: "active-owner" }
      );
    resetRegisteredPoms();
    const mine = (owner = {});
    return () => {
      if (owner !== mine) return;
      resetRegisteredPoms();
      owner = undefined;
    };
  }

  return {
    claim,
    listAvailablePomTools,
    listRootedToolInstances,
    listRegisteredPomRoots,
    listRegisteredPomTargets,
    listRegisteredPomTools,
    listRegisteredPoms,
    probeRegisteredPomMembers,
    readRegisteredPomScreen,
    registerPageObject,
    resetRegisteredPoms,
    subscribeToRegisteredPoms,
  };
}

/** A Page's Page Object registry. */
export type PomRegistry = ReturnType<typeof createPomRegistry>;

/** `instance`'s availability for `methodName`, as the last observation read it. */
function availabilityNow(
  driver: PageDriver,
  instance: PomInstanceObservation,
  methodName: string
): ToolAvailability {
  return availabilityOf(instance, methodName, driver.latestPageStateRef);
}

/**
 * The present items `tool` of `registration` goes through, as last observed,
 * each with the tool's verdict on it and the ref its root had in that
 * observation: what the Goal Loop offers and what a call on an item is
 * refused by.
 */
function rootedInstancesOf(
  driver: PageDriver,
  instances: readonly PomInstanceObservation[],
  tool: RegisteredPomTool
): RootedToolInstance[] {
  return instances.flatMap((instance) => {
    const { root } = instance;
    return instance.present && root?.present && root.ref
      ? [
          {
            ref: root.ref,
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
  instancesOf: (tool: RegisteredPomTool) => readonly PomInstanceObservation[],
  instanceRefs: InstanceRefs
): CallerAwarePomTool {
  const tool: CallerAwarePomTool = {
    ...facts,
    execute: async (input, context) => {
      let args = input;
      let targetName = tool.name;
      // The rule a defaulted pattern keeps beside the input schema.
      refuseViolations(
        tool.rooted
          ? patternViolations(
              action.parameters,
              (input as { args?: Record<string, unknown> }).args ?? {},
              "args"
            )
          : patternViolations(
              action.parameters,
              input as Record<string, unknown>
            )
      );
      const instances = instancesOf(tool);
      let observed: PomInstanceObservation | undefined = instances[0];
      if (tool.rooted) {
        const { ref, args: actionArgs = {} } = input as {
          ref: string;
          args?: object;
        };
        args = actionArgs;
        const label = `call ${tool.name} on`;
        const resolved = isInstanceRef(ref)
          ? await instanceRefs.rootOf(ref)
          : (await context.pageStateSession.resolveRef(ref, label)).ref;
        if (resolved === undefined)
          throw new RefResolutionError(
            refFailure(label, ref, "it is not on the page")
          );
        const previous = await rootedAt(driver, instances, resolved);
        observed = await rootedAt(driver, instancesOf(tool), resolved);
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
      const target = await callTarget(driver, targetName, observed);
      return performPageObjectAction(target, action, args, context, targetName);
    },
  };
  return tool;
}

/**
 * The instance whose root's Locator resolves to the one element the Structural
 * Ref `ref` names, as the page driver checks now: what tells a ref from
 * another instance's, or from the root a Locator has moved on to.
 */
async function rootedAt(
  driver: PageDriver,
  instances: readonly PomInstanceObservation[],
  ref: string
): Promise<PomInstanceObservation | undefined> {
  for (const instance of instances)
    if (
      instance.rootLocator !== undefined &&
      instance.root?.ref &&
      (await driver.names(instance.rootLocator, ref))
    )
      return instance;
  return undefined;
}

/**
 * What a call of a Page Object Tool acts on: the live instance and, for a
 * rooted one, the Locator of its root, which the page driver resolves to one
 * element now.
 */
type CallTarget = {
  instance: object;
  root: { locator: Locator } | undefined;
};

/**
 * The target of a call of the tool `toolName` on `observed`, as the last
 * observation read it: the call runs no root predicate of its own. Refused
 * when the observation found no instance, or its own root has since left
 * the page or resolves to another element.
 */
async function callTarget(
  driver: PageDriver,
  toolName: string,
  observed: PomInstanceObservation | undefined
): Promise<CallTarget> {
  const root = observed && (await heldRoot(driver, observed));
  if (!observed || root === false)
    throw unavailableError(toolName, { present: false });
  return { instance: observed.instance, root };
}

/**
 * The root the observation found `observed` at, while it is still its
 * root: a root-less instance has none to lose (undefined); a rooted one
 * keeps it while its locator resolves to that one element. false once it is
 * lost.
 */
async function heldRoot(
  driver: PageDriver,
  observed: PomInstanceObservation
): Promise<CallTarget["root"] | false> {
  if (observed.rootLocator === undefined)
    return observed.root === undefined ? undefined : false;
  const ref = observed.root?.ref;
  if (!ref) return false;
  return (await driver.names(observed.rootLocator, ref))
    ? { locator: observed.rootLocator }
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
  { cursor, page, pageStateSession, reach }: RunContext,
  targetName: string
): Promise<ActionResult> {
  const method = Reflect.get(instance, tool.methodName);
  if (!isCallable(method))
    throw new RuntimeStateError(
      `POM method ${tool.methodName} is not callable.`
    );

  const parameters = methodArguments(
    tool.parameters,
    args as Record<string, unknown>
  );
  if (root)
    await assertLocatorReachable(
      reach,
      page,
      targetName,
      root.locator,
      "click",
      (ref) => pageStateSession.latestRefOfNamed(ref)
    );
  // A tool may be called without the Caller ever having read the page; the
  // Change Record then starts from the page right before the action.
  return pageStateSession.runAction(cursor, { tool: tool.toolName, args }, () =>
    method.apply(instance, parameters)
  );
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}
