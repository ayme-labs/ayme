import type {
  JsonSchema,
  PomComponentManifest,
  PomComponentMemberManifest,
  PomManifest,
  PomMemberManifest,
  PomMemberObservation,
  RegisteredPomTool,
  ToolManifest,
} from "./contracts";
import {
  inputParameters,
  inputSchemaFor,
  methodArguments,
  actionFacts,
} from "./actionTool";
import { throwViolations, toolInputViolations } from "./schemaValidation";
import { createPage } from "./browserPage";
import {
  isPlaywrightLiteLocator,
  resolveLocatorElements,
} from "@ayme-dev/playwright-lite/internal";
import type { Locator, Page } from "@playwright/test";
import { modelOption } from "./decorators";
import { assertRootReachable } from "./elementReach";
import { observePomRoot, type ObservedPomRoot } from "./pomRootObservation";
import {
  getInteractionHistory,
  latestPageStateRef,
  onlyHitTestMarks,
} from "./pageState";
import {
  askPredicates,
  askPresence,
  assertAvailable,
  availabilityOf,
  combinedAvailability,
  sameInstance,
  type PomInstanceObservation,
  type ToolAvailability,
  unavailableError,
} from "./pomInstance";
import { registerRefSelectorEngine } from "./refSelectorEngine";
import { refFailure, resolveRef } from "./refTarget";
import type { Cursor } from "./cursors";
import type { RunContext } from "./run";
import { runAction, type ActionResult } from "./actionSequence";
import { errorText, RefResolutionError, RuntimeStateError } from "./errors";

export type PageObjectConstructor<T extends object = object> = new (
  page: Page
) => T;

type ScopedPomTool = RegisteredPomTool & {
  /** The component it acts on, without item indices, e.g. "items[].details". */
  componentPath?: string;
  /**
   * For a tool that goes through a collection, the path of the items a
   * ref names, e.g. "items[]" for "items[].details".
   */
  collectionPath?: string;
};

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
 * An element a Page Object member holds, at the member's concrete path, e.g.
 * "ListPage.items[0].nameButton", or at `rootTargetPath` of a Page Object's
 * path for its root.
 */
export type RegisteredPomTarget = {
  path: string;
  element: Element;
  /**
   * The member's locator, as its `toString()` reads, e.g.
   * "getByRole('button', { name: 'Add item' })": the locator an Interaction
   * on the member names.
   */
  locator: string;
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
  tools: readonly CallerAwarePomTool[];
};

/**
 * A collection tool's item, labelled as the page state labels it, with
 * whether the tool would run on it now and why not.
 */
export type CollectionToolItem = RegisteredPomRoot & ToolAvailability;

let browserPage: Page | undefined;
let runtimeOwner: object | undefined;
const compiledPoms = new WeakMap<object, PomManifest>();
const registeredPoms = new Set<ObservedRegisteredPom>();
// Registrations refused for a same-named class, in the order they were
// made: each gets in once the registration it clashes with is disposed.
const waitingPoms = new Set<ObservedRegisteredPom>();
const subscribers = new Set<() => void>();
let mutationObserver: MutationObserver | undefined;
let stopWatchingNavigations: (() => void) | undefined;
let probeTimer: ReturnType<typeof setTimeout> | undefined;
let observedWindow: Window | null = null;
let probeLifetime = 0;
let probeInFlight: Promise<void> | undefined;
// Only read after runPomMemberProbe or stopObservingPage has set it.
// Stryker disable next-line BooleanLiteral: equivalent, its first value is never read
let probePending = false;
const layoutEvents = [
  "scroll",
  "resize",
  "transitionend",
  "transitioncancel",
  "animationend",
  "animationcancel",
] as const;

export function requireAymeRuntimePage(): Page {
  if (!browserPage)
    throw new RuntimeStateError("The Ayme browser runtime is not configured.");
  return browserPage;
}

export function createAymeRuntime(page?: object) {
  if (runtimeOwner)
    throw new RuntimeStateError(
      "The Ayme runtime already has an active owner.",
      { code: "active-owner" }
    );

  resetRegisteredPoms();
  browserPage = undefined;
  const owner = {};
  const runtimePage = page ?? createPage();
  runtimeOwner = owner;
  browserPage = runtimePage as Page;
  // The page's locators for Structural Refs resolve through Ayme's engine.
  registerRefSelectorEngine();

  return {
    page: runtimePage,
    dispose() {
      if (runtimeOwner !== owner) return;
      resetRegisteredPoms();
      browserPage = undefined;
      runtimeOwner = undefined;
    },
  };
}

function resetRegisteredPoms() {
  const hadRegistrations = registeredPoms.size > 0;
  registeredPoms.clear();
  waitingPoms.clear();
  stopObservingPage();
  if (hadRegistrations) notifySubscribers();
}

export function registerCompiledPom(PomClass: object, manifest: PomManifest) {
  compiledPoms.set(PomClass, manifest);
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
  const registration: ObservedRegisteredPom = {
    id: compiledPom.className,
    pomClass: PomClass,
    instance,
    manifest: compiledPom,
    memberObservations: [],
    presentPaths: new Set(),
    rootMemberPaths: new Set(),
    instances: undefined,
    tools: [],
  };
  // Its collection tools read the instances observed of this registration.
  registration.tools = createRegisteredTools(registration);
  // A clash between the app's own classes is logged rather than thrown, so
  // it does not take down the component, or the session start, that
  // registered the Page Object. It lists no tools until the clash is gone.
  const refusal = sameNamedClassRefusal(PomClass, compiledPom);
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
        if (!sameNamedClassRefusal(waiting.pomClass, waiting.manifest)) {
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

/**
 * Ayme tells Page Object classes apart by name: tools are named after their
 * class, and definitions and Page Object Children are looked up by it. So no
 * two different classes the registered Page Objects reach, at any depth, may
 * share a name. Children carry no class at runtime, only their compiled
 * manifest, so two of one name are the same class when the build plugin
 * found them in the same file: an HMR update recompiles a class there while
 * Page Objects reaching its old version are still registered. A manifest
 * without a file is the same class when it is the same manifest.
 */
function sameNamedClassRefusal(
  PomClass: object,
  manifest: PomManifest
): RuntimeStateError | undefined {
  // A different class with the same name would have its tools hidden by the
  // first one registered.
  for (const registered of registeredPoms)
    if (
      registered.id === manifest.className &&
      registered.pomClass !== PomClass
    )
      return new RuntimeStateError(
        `Cannot register the Page Object "${manifest.className}": a different class with that name is already registered${declaredIn(registered.manifest, manifest)}.`,
        { code: "same-named-class" }
      );

  type Reached = { pageObject: string; node: PomComponentManifest };
  // Every distinct class of each name, so a manifest without a file cannot
  // stand in for two classes from different files.
  const reached = new Map<string, Reached[]>();
  const reach = (pageObject: string, pom: PomManifest) => {
    for (const node of [pom, ...pom.components]) {
      const others = reached.get(node.className) ?? [];
      const other = others.find((other) => !sameClass(other.node, node));
      if (other)
        return new RuntimeStateError(
          `Cannot register the Page Object "${manifest.className}": ${
            other.pageObject === manifest.className
              ? `it reaches two different classes named "${node.className}"`
              : `it reaches a class named "${node.className}" that differs from the one the Page Object "${other.pageObject}" reaches`
          }${declaredIn(other.node, node)}. Ayme tells the classes of Page Objects apart by name.`,
          { code: "same-named-class" }
        );
      if (!others.some((other) => other.node.file === node.file))
        reached.set(node.className, [...others, { pageObject, node }]);
    }
    return undefined;
  };
  // Registered Page Objects can stop matching each other once one leaves,
  // as a manifest without a file matches by shape: the new one is refused
  // then too.
  for (const registered of registeredPoms) {
    const refusal = reach(registered.id, registered.manifest);
    if (refusal) return refusal;
  }
  return reach(manifest.className, manifest);
}

function sameClass(first: PomComponentManifest, second: PomComponentManifest) {
  return first.file !== undefined && second.file !== undefined
    ? first.file === second.file
    : classShape(first) === classShape(second);
}

function classShape({
  className,
  description,
  members,
  tools,
}: PomComponentManifest) {
  return JSON.stringify({ className, description, members, tools });
}

function declaredIn(first: PomComponentManifest, second: PomComponentManifest) {
  return first.file === undefined || second.file === undefined
    ? ""
    : `, declared in ${first.file} and ${second.file}`;
}

function startObservingPage() {
  mutationObserver = new MutationObserver((records) => {
    if (!onlyHitTestMarks(records)) schedulePomMemberProbe();
  });
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  observedWindow = document.defaultView ?? null;
  for (const event of layoutEvents)
    observedWindow?.addEventListener(event, schedulePomMemberProbe, true);
  // A same-document navigation changes no DOM by itself, but a presence
  // predicate may read the URL: the Page State Session's Visit signal.
  stopWatchingNavigations = getInteractionHistory(document).onNavigation(
    schedulePomMemberProbe
  );
  schedulePomMemberProbe();
}

function stopObservingPage() {
  probeLifetime += 1;
  probeInFlight = undefined;
  probePending = false;
  for (const event of layoutEvents)
    observedWindow?.removeEventListener(event, schedulePomMemberProbe, true);
  observedWindow = null;
  stopWatchingNavigations?.();
  stopWatchingNavigations = undefined;
  mutationObserver?.disconnect();
  mutationObserver = undefined;
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

export async function probeRegisteredPomMembers(): Promise<void> {
  const lifetime = probeLifetime;
  await runPomMemberProbe();
  // Await at most one follow-up. A live page need not become quiet to be read.
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
  // ends only once every observation has, even when a subscriber throws, so
  // a later probe's observation is never overwritten by an older one.
  const settled = await Promise.allSettled(
    [...registeredPoms].map(async (registration) => {
      const observed = await probePomMembers(registration);
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
 * the last observation read; whether it found anything new.
 */
function commitObservation(
  registration: ObservedRegisteredPom,
  {
    memberObservations,
    instances,
    rootMemberPaths,
  }: Awaited<ReturnType<typeof probePomMembers>>
): boolean {
  if (!registeredPoms.has(registration)) return false;
  const previous = registration.instances?.all;
  const same =
    previous?.length === instances.length &&
    previous.every((instance, index) =>
      sameInstance(instance, instances[index]!)
    ) &&
    sameObservations(registration.memberObservations, memberObservations);
  registration.memberObservations = memberObservations;
  registration.presentPaths = new Set(
    instances.flatMap((instance) => (instance.present ? [instance.path] : []))
  );
  registration.rootMemberPaths = rootMemberPaths;
  registration.instances = groupedInstances(instances);
  return !same;
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

export function listRegisteredPoms(): RegisteredPom[] {
  return [...registeredPoms];
}

export async function listRegisteredPomRoots(): Promise<RegisteredPomRoot[]> {
  return (await getRegisteredPomStructure()).roots;
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

// Capture labels and exclusions from the same completed observation. A
// present Page Object's root is labelled; a root that is not on the page is
// left out of the capture, while one whose Page Object a predicate withdrew
// is unlabelled rendered content.
export async function getRegisteredPomStructure() {
  await probeRegisteredPomMembers();
  const observations = [...registeredPoms].flatMap((registration) =>
    (registration.instances?.all ?? []).flatMap(({ path, root, present }) =>
      root
        ? [
            {
              root,
              present,
              label: path ? `${registration.id}.${path}` : registration.id,
            },
          ]
        : []
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

function isRootPresent<T extends ObservedPomRoot>(
  root: T
): root is T & { element: Element } {
  return root.present && root.element?.isConnected === true;
}

/**
 * Package-internal: the path of the target that is the Page Object Root of
 * the instance at `path`, e.g. "ListPage.items[0].@root". The segment is one
 * no member is named, so a member named `root` never shares a path with it.
 */
export function rootTargetPath(path: string) {
  return `${path}.@root`;
}

/**
 * Package-internal: every element the registered Page Objects' members hold,
 * one target per element and concrete member path, in registration and
 * declaration order. Paths through collections carry their item indices.
 */
export async function listRegisteredPomTargets(): Promise<
  RegisteredPomTarget[]
> {
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

/**
 * Package-internal: every registered Page Object tool, one per name, with
 * whether it is present, available now, and why not (ADR-0035). A tool is
 * present while its Page Object, or the component instance it acts on, is;
 * available while that Page Object is available and the action's predicate,
 * if it has one, holds. A collection action stands for every present
 * instance: it is available while any instance is, and when none is, its
 * reason is the first present instance's. Of tools sharing a name, the first
 * available one wins, else the first present, else the first registered.
 */
export function listRegisteredPomTools(): ({
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
      const listed = tools.get(tool.name);
      if (
        !listed ||
        (availability.available && !listed.available) ||
        (availability.present && !listed.present)
      )
        tools.set(tool.name, { tool, ...availability });
    }
  return [...tools.values()];
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
 * Package-internal: the available Page Object tools, the ones a call can
 * run now, with the run that takes a caller.
 */
export function listAvailablePomTools(): CallerAwarePomTool[] {
  return listRegisteredPomTools().flatMap(({ tool, available }) =>
    available ? [tool] : []
  );
}

/**
 * Package-internal: the present items each tool that goes through a
 * collection acts on, by tool name, labelled as the page state labels them,
 * each with whether the tool would run on it now and why not. A tool whose
 * path holds no collection is absent from the map.
 */
export function listCollectionToolItems(): Map<string, CollectionToolItem[]> {
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

export function subscribeToRegisteredPoms(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function notifySubscribers() {
  for (const subscriber of subscribers) subscriber();
}

/**
 * Package-internal: tells the subscribers to read the tools again although
 * no observation changed, as when a recorded page state gave the element in
 * an unavailable root's way its ref.
 */
export function announceRegisteredPomChange() {
  const obstructed = [...registeredPoms].some((registration) =>
    registration.instances?.all.some(
      (instance) => instance.root?.inTheWay.length
    )
  );
  if (obstructed) notifySubscribers();
}

function createRegisteredTools(registration: ObservedRegisteredPom) {
  const { manifest } = registration;
  const pageTools = manifest.tools.map((tool) =>
    createRegisteredTool(registration, tool)
  );
  const components = new Map(
    manifest.components.map((component) => [component.className, component])
  );
  const componentTools = manifest.members.flatMap((member) => {
    if (member.kind !== "component") return [];
    const component = components.get(member.componentClassName);
    if (!component) return [];
    return createComponentTools(registration, [member], component, components);
  });
  return [...pageTools, ...componentTools];
}

function createRegisteredTool(
  registration: ObservedRegisteredPom,
  action: ToolManifest
): CallerAwarePomTool {
  const tool: CallerAwarePomTool = {
    pomId: registration.manifest.className,
    methodName: action.methodName,
    name: action.toolName,
    ...actionFacts(action, registration.manifest.className),
    inputSchema: inputSchemaFor(action.parameters),
    parameters: inputParameters(action.parameters),
    execute: async (args, { cursor }) =>
      performPageObjectAction(
        callTarget(tool.name, instancesOf(registration, tool)[0]),
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
  toolName: string,
  observed: PomInstanceObservation | undefined
): CallTarget {
  if (
    !observed ||
    !rootHolds(observed) ||
    (observed.item !== undefined &&
      observed.item !== observed &&
      !rootHolds(observed.item))
  )
    throw unavailableError(toolName, { present: false });
  return { instance: observed.instance, root: observed.rootLocator };
}

/**
 * Whether the root the observation found `observed` at is still its root:
 * a root-less instance has none to lose; a rooted one keeps it while its
 * locator still resolves to that one element.
 */
function rootHolds(observed: PomInstanceObservation): boolean {
  if (observed.rootLocator === undefined) return observed.root === undefined;
  const element = observed.root?.element;
  if (!element?.isConnected) return false;
  const elements = locatorElements(observed.rootLocator);
  return elements.length === 1 && elements[0] === element;
}

/**
 * The locator that anchors `instance`, its Page Object Root: what the `root`
 * option its class declares or inherits answers. Undefined without the
 * option, or when the answer is not a locator; a root predicate that throws,
 * throws.
 */
async function readRoot(instance: object): Promise<Locator | undefined> {
  const predicate = modelOption(instance.constructor, "root");
  if (!predicate) return undefined;
  const root = await predicate(instance as never);
  return isLocator(root) ? root : undefined;
}

/** `instance`'s root, or undefined when it cannot be read as a locator. */
const declaredRoot = (instance: object) =>
  readRoot(instance).catch(() => undefined);

function createComponentTools(
  registration: ObservedRegisteredPom,
  path: readonly PomComponentMemberManifest[],
  component: PomComponentManifest,
  components: ReadonlyMap<string, PomComponentManifest>,
  componentPath: ReadonlySet<string> = new Set()
): CallerAwarePomTool[] {
  if (componentPath.has(component.className)) return [];
  const nextComponentPath = new Set(componentPath).add(component.className);
  const tools = component.tools.map((action) =>
    createComponentTool(registration, path, component, action)
  );
  const nestedTools = component.members.flatMap((member) => {
    if (member.kind !== "component") return [];
    const childComponent = components.get(member.componentClassName);
    if (!childComponent) return [];
    return createComponentTools(
      registration,
      [...path, member],
      childComponent,
      components,
      nextComponentPath
    );
  });
  return [...tools, ...nestedTools];
}

function createComponentTool(
  registration: ObservedRegisteredPom,
  path: readonly PomComponentMemberManifest[],
  component: PomComponentManifest,
  action: ToolManifest
): CallerAwarePomTool {
  const { id: pomId } = registration;
  const componentPath = componentPathFor(path);
  const collectionCount = path.filter((member) => member.collection).length;
  if (collectionCount === 0)
    return createSingularComponentTool(
      registration,
      path,
      component,
      action,
      componentPath
    );

  const wrapper = refComponentToolManifest(pomId, path, action);
  const itemDepth = path.map((member) => member.collection).lastIndexOf(true);
  const execute: CallerAwarePomTool["execute"] = async (input, { cursor }) => {
    const values = validatedArguments(wrapper, input);
    const ref = values[0] as string;
    const args = values[1] ?? {};
    const toolPath = `${pomId}.${publicComponentPath(path)}`;
    const label = `call ${wrapper.toolName} on`;
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
          `it is not an instance of ${component.className} at ${toolPath}`
        )
      );
    }
    const item = collectionItemsOf(registration, tool).find(
      (candidate) => candidate.element === element
    );
    assertAvailable(tool.name, item ?? { present: false, available: false });
    return await performPageObjectAction(
      callTarget(tool.name, observed),
      action,
      args,
      cursor
    );
  };
  const tool: CallerAwarePomTool = {
    pomId,
    componentClassName: component.className,
    componentPath,
    collectionPath: componentPathFor(path.slice(0, itemDepth + 1)),
    methodName: action.methodName,
    name: wrapper.toolName,
    ...actionFacts(action, component.className),
    inputSchema: inputSchemaFor(wrapper.parameters),
    parameters: wrapper.parameters,
    execute,
  };
  return tool;
}

function createSingularComponentTool(
  registration: ObservedRegisteredPom,
  path: readonly PomComponentMemberManifest[],
  component: PomComponentManifest,
  action: ToolManifest,
  componentPath: string
): CallerAwarePomTool {
  const tool: CallerAwarePomTool = {
    pomId: registration.id,
    componentClassName: component.className,
    componentPath,
    methodName: action.methodName,
    name: `${registration.id}.${publicComponentPath(path)}.${action.methodName}`,
    ...actionFacts(action, component.className),
    inputSchema: inputSchemaFor(action.parameters),
    parameters: inputParameters(action.parameters),
    execute: async (input, { cursor }) =>
      performPageObjectAction(
        callTarget(tool.name, instancesOf(registration, tool)[0]),
        action,
        input,
        cursor
      ),
  };
  return tool;
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
      // An action that needs no input runs on `{}`, so `args` may be omitted.
      optional: inputParameters(action.parameters).every(
        (parameter) => parameter.optional
      ),
      schema: inputSchemaFor(action.parameters),
    },
  ];

  return {
    ...action,
    toolName: `${pomId}.${publicComponentPath(path)}.${action.methodName}`,
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

async function probePomMembers(registration: ObservedRegisteredPom) {
  const { instance, manifest } = registration;
  const walk: Walk = {
    registration,
    components: new Map(
      manifest.components.map((component) => [component.className, component])
    ),
    instances: [],
    rootMemberPaths: new Set(),
  };
  const place: Place = {
    path: "",
    componentPath: "",
    item: undefined,
    present: false,
  };
  // Its presence predicate is asked before its root is read or any member
  // is: an absent Page Object costs one call, and its members are not walked.
  const presence = await askPresence(instance);
  reportPredicateError(registration, place.path, "present", presence.error);
  const absent = presence.present === false;
  const root = absent ? undefined : await observeRoot(instance);
  reportPredicateError(registration, place.path, "root", root?.error);
  const present = !absent && (root?.root.present ?? true);
  walk.instances.push({
    ...place,
    instance,
    componentPath: undefined,
    present,
    presenceError: presence.error,
    root: root?.root,
    rootLocator: root?.locator,
    rootError: root?.error,
    predicates: present
      ? await askPredicates(instance, manifest.tools)
      : new Map(),
  });
  if (absent)
    return {
      memberObservations: [],
      instances: walk.instances,
      rootMemberPaths: walk.rootMemberPaths,
    };
  const memberObservations = await probeMembers(
    walk,
    instance,
    manifest.members,
    { ...place, present, rootElement: root?.root.element },
    new Set()
  );
  return {
    memberObservations,
    instances: walk.instances,
    rootMemberPaths: walk.rootMemberPaths,
  };
}

/**
 * Logs what the `option` predicate of `registration`'s instance at `path`
 * threw, once: again only when a later observation finds another error.
 */
function reportPredicateError(
  registration: ObservedRegisteredPom,
  path: string,
  option: "present" | "root",
  error: string | undefined
) {
  if (error === undefined) return;
  const previous = registration.instances?.all.find(
    (instance) => instance.path === path
  );
  const reported =
    option === "present" ? previous?.presenceError : previous?.rootError;
  if (reported === error) return;
  const label = path ? `${registration.id}.${path}` : registration.id;
  console.error(
    `The Page Object "${label}" is absent: its ${option} predicate threw ${error}.`
  );
}

/** One walk over a registered Page Object's members. */
type Walk = {
  registration: ObservedRegisteredPom;
  components: ReadonlyMap<string, PomComponentManifest>;
  /** Every instance the walk found, parents before their members. */
  instances: PomInstanceObservation[];
  /** The paths of the locator members that resolved to their root. */
  rootMemberPaths: Set<string>;
};

/** Where in the walk an instance's members are. */
type Place = Pick<PomInstanceObservation, "path" | "item"> & {
  componentPath: string;
  /**
   * Whether the instance is present: what a root-less single child with no
   * predicate follows.
   */
  present: boolean;
  /**
   * The one element the instance's root locator resolved to, when it did: a
   * locator member resolving to that element alone is the root, not a child.
   */
  rootElement?: Element;
};

/** What observing an instance's declared root found. */
type RootObservation = {
  root: ObservedPomRoot;
  /** How many elements the root locator matched. */
  count: number;
  /** The locator the root predicate answered, when it answered one. */
  locator?: Locator;
  /** What the root predicate threw, when it threw. */
  error?: string;
};

/**
 * Observes `instance`'s declared root. A root the predicate throws on, or
 * answers no locator for, never falls back to rootless activation: it is
 * absent.
 */
async function observeRoot(
  instance: object
): Promise<RootObservation | undefined> {
  // A rootless Page Object with no predicate is on every page.
  if (!modelOption(instance.constructor, "root")) return undefined;
  let locator: Locator | undefined;
  try {
    locator = await readRoot(instance);
  } catch (error) {
    return { root: absentRoot, count: 0, error: errorText(error) };
  }
  if (!locator) return { root: absentRoot, count: 0 };
  return { ...(await observePomRoot(locator)), locator };
}

const absentRoot: ObservedPomRoot = {
  element: undefined,
  present: false,
  available: false,
  inTheWay: [],
};

/**
 * `instance`'s targets at `prefix`: its root's elements at the root target
 * path, then its members', without the member that resolves to the root.
 */
async function collectPomTargets(
  instance: object,
  members: readonly PomMemberManifest[],
  prefix: string,
  components: ReadonlyMap<string, PomComponentManifest>,
  targets: RegisteredPomTarget[],
  componentClasses: ReadonlySet<string> = new Set()
): Promise<void> {
  const rootElement = await collectRootTargets(instance, prefix, targets);
  for (const member of members) {
    const memberPath = `${prefix}.${member.memberName}`;
    try {
      const value = await readMember(instance, member);
      if (member.kind === "locator") {
        if (!isLocator(value) || resolvesToRoot(value, rootElement)) continue;
        const locator = value.toString();
        for (const element of locatorElements(value))
          targets.push({ path: memberPath, element, locator });
        continue;
      }

      const component = components.get(member.componentClassName);
      if (!component) continue;
      const values = member.collection ? asComponents(value) : [value];
      for (const [index, candidate] of values.entries()) {
        if (!isRecord(candidate)) continue;
        const componentPath = member.collection
          ? `${memberPath}[${index}]`
          : memberPath;
        if (componentClasses.has(component.className)) {
          await collectRootTargets(candidate, componentPath, targets);
          continue;
        }
        await collectPomTargets(
          candidate,
          component.members,
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

/**
 * Pushes the elements `instance`'s root resolves to as targets at the root
 * target path of `prefix`, and answers the one element it resolved to, when
 * it did.
 */
async function collectRootTargets(
  instance: object,
  prefix: string,
  targets: RegisteredPomTarget[]
): Promise<Element | undefined> {
  const root = await declaredRoot(instance);
  if (!root) return undefined;
  const elements = locatorElements(root);
  const locator = root.toString();
  const path = rootTargetPath(prefix);
  for (const element of elements) targets.push({ path, element, locator });
  return elements.length === 1 ? elements[0] : undefined;
}

async function probeMembers(
  walk: Walk,
  instance: object,
  members: readonly PomMemberManifest[],
  place: Place,
  ancestors: ReadonlySet<object>
): Promise<PomMemberObservation[]> {
  if (ancestors.has(instance)) return [];
  const nextAncestors = new Set(ancestors).add(instance);
  const observations: PomMemberObservation[] = [];
  for (const member of members) {
    const memberPath = joinPath(place.path, member.memberName);
    try {
      const value = await readMember(instance, member);
      if (member.kind === "locator") {
        if (isLocator(value) && resolvesToRoot(value, place.rootElement)) {
          walk.rootMemberPaths.add(memberPath);
          continue;
        }
        observations.push(await observeLocator(value, member, memberPath));
      } else
        await probeComponentMember(
          walk,
          value,
          member,
          place,
          nextAncestors,
          observations
        );
    } catch (error) {
      observations.push(failedObservation(member, memberPath, error));
    }
  }
  return observations;
}

/**
 * Whether `locator` resolves to `rootElement` alone, so the member holding
 * it is the Page Object Root. By element, not by Locator identity: a getter
 * may build a fresh Locator on each read.
 */
function resolvesToRoot(locator: Locator, rootElement: Element | undefined) {
  if (!rootElement) return false;
  const elements = locatorElements(locator);
  return elements.length === 1 && elements[0] === rootElement;
}

async function observeLocator(
  value: unknown,
  member: PomMemberManifest,
  memberPath: string
): Promise<PomMemberObservation> {
  if (!isLocator(value))
    throw new RuntimeStateError(
      `POM member ${memberPath} is not a browser locator.`
    );
  return {
    memberName: memberPath,
    kind: "locator",
    access: member.access,
    count: await value.count(),
  };
}

/**
 * Walks the component, or each component of the collection, a member of
 * the instance at `place` holds, into `observations`.
 */
async function probeComponentMember(
  walk: Walk,
  value: unknown,
  member: PomComponentMemberManifest,
  place: Place,
  ancestors: ReadonlySet<object>,
  observations: PomMemberObservation[]
) {
  const manifest = walk.components.get(member.componentClassName);
  if (!manifest)
    throw new RuntimeStateError(
      `No metadata found for component ${member.componentClassName}.`
    );
  const memberPath = joinPath(place.path, member.memberName);
  const componentPath = joinPath(
    place.componentPath,
    `${member.memberName}${member.collection ? "[]" : ""}`
  );
  const values = member.collection ? asComponents(value) : [value];
  if (member.collection)
    observations.push({
      memberName: memberPath,
      kind: "component-collection",
      access: member.access,
      count: values.length,
    });
  for (const [index, component] of values.entries()) {
    const path = member.collection ? `${memberPath}[${index}]` : memberPath;
    // A child whose root cannot be observed is absent, and the observation
    // says why.
    const rootObservation = (error: string): PomMemberObservation => ({
      memberName: `${path}.root`,
      kind: "component-root",
      count: 0,
      error,
    });
    if (!isRecord(component)) {
      observations.push(
        rootObservation(`POM component ${path} is not an object.`)
      );
      continue;
    }
    const observed: PomInstanceObservation = {
      path,
      instance: component,
      componentPath,
      item: place.item,
      present: false,
      root: undefined,
      predicates: new Map(),
    };
    if (member.collection) observed.item = observed;
    // Its presence predicate is asked before its root is read or any member
    // is, as the page's own: a child it withdraws costs one call.
    const presence = await askPresence(component);
    reportPredicateError(walk.registration, path, "present", presence.error);
    if (presence.present === false) {
      observed.presenceError = presence.error;
      walk.instances.push(observed);
      continue;
    }
    // Whether the child is on the page: a rooted one while its root is, a
    // root-less one with a predicate by the predicate alone, a root-less
    // single child with neither while the Page Object it is reached through
    // is. A collection item needs a root for its ref, which the build
    // refuses when every options object in the chain is an inline literal
    // naming no root; anything else is reported here, at observation.
    let present: boolean;
    const root = await observeRoot(component);
    if (root) {
      reportPredicateError(walk.registration, path, "root", root.error);
      observed.root = root.root;
      observed.rootLocator = root.locator;
      observed.rootError = root.error;
      if (root.error !== undefined || !root.locator) {
        observations.push(
          rootObservation(
            root.error === undefined
              ? `POM component ${path}'s root is not a browser locator.`
              : `POM component ${path}'s root could not be read: ${root.error}.`
          )
        );
        walk.instances.push(observed);
        continue;
      }
      observations.push({
        memberName: `${path}.root`,
        kind: "component-root",
        count: root.count,
      });
      present = root.root.present;
    } else if (member.collection) {
      observations.push(
        rootObservation(`POM component ${path} declares no root.`)
      );
      continue;
    } else present = presence.present ?? place.present;
    observed.present = present;
    if (present)
      observed.predicates = await askPredicates(component, manifest.tools);
    walk.instances.push(observed);
    // A child absent by its root is still walked: a present Page Object
    // inside one that is not on the page stays listed (ADR-0020).
    observations.push(
      ...(await probeMembers(
        walk,
        component,
        manifest.members,
        {
          path,
          componentPath,
          item: observed.item,
          present,
          rootElement: observed.root?.element,
        },
        ancestors
      ))
    );
  }
}

function failedObservation(
  member: PomMemberManifest,
  memberPath: string,
  error: unknown
): PomMemberObservation {
  return {
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
  };
}

function joinPath(prefix: string, name: string) {
  return prefix ? `${prefix}.${name}` : name;
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
    validatedArguments(tool, args)
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

function validatedArguments(tool: ToolManifest, args: unknown) {
  throwViolations(toolInputViolations(inputSchemaFor(tool.parameters), args));
  const input = args as Record<string, unknown>;
  // An inherited name, such as constructor, is no argument.
  return tool.parameters.map((parameter) =>
    Object.hasOwn(input, parameter.name) ? input[parameter.name] : undefined
  );
}

function isCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function isLocator(value: unknown): value is Locator {
  return isPlaywrightLiteLocator(value);
}

function locatorElements(locator: Locator): Element[] {
  return resolveLocatorElements(locator);
}

function asComponents(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new RuntimeStateError("Expected a component collection array.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
