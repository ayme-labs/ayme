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
  toolDescription,
} from "./actionTool";
import { throwFirstViolation, toolInputViolations } from "./schemaValidation";
import { createPage } from "./browserPage";
import {
  isPlaywrightLiteLocator,
  resolveLocatorElements,
} from "@ayme-dev/playwright-lite/internal";
import type { Locator, Page } from "@playwright/test";
import { observePomRoot } from "./pomRootObservation";
import { resolvePageStateRefs, type AriaRef } from "./pageState";
import {
  askPredicates,
  assertAvailable,
  availabilityOf,
  combinedAvailability,
  sameInstance,
  type ObservedPomRoot,
  type PomInstanceObservation,
  type ToolAvailability,
} from "./pomInstance";
import { requireStructuralRef } from "./refTarget";
import type { Cursor } from "./cursors";
import type { RunContext } from "./run";
import { runAction, type ActionResult } from "./actionSequence";
import { RefResolutionError, RuntimeStateError } from "./errors";

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
  tools: readonly ScopedPomTool[];
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
const subscribers = new Set<() => void>();
let mutationObserver: MutationObserver | undefined;
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

export function configureAymeRuntime(page: Page) {
  if (runtimeOwner)
    throw new RuntimeStateError(
      "The Ayme runtime already has an active owner.",
      { code: "active-owner" }
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
      "The Ayme runtime already has an active owner.",
      { code: "active-owner" }
    );

  resetRegisteredPoms();
  browserPage = undefined;
  const owner = {};
  const runtimePage = page ?? createPage();
  runtimeOwner = owner;
  browserPage = runtimePage as Page;

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
  stopObservingPage();
  if (hadRegistrations) notifySubscribers();
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
  rejectSameNamedClasses(PomClass, compiledPom);
  const registration: ObservedRegisteredPom = {
    id: compiledPom.className,
    pomClass: PomClass,
    instance,
    manifest: compiledPom,
    memberObservations: [],
    instances: undefined,
    tools: [],
  };
  // Its collection tools read the instances observed of this registration.
  registration.tools = createRegisteredTools(registration);
  const registryWasEmpty = registeredPoms.size === 0;
  registeredPoms.add(registration);
  if (registryWasEmpty) startObservingPage();
  else schedulePomMemberProbe();
  notifySubscribers();

  return {
    instance,
    dispose() {
      if (!registeredPoms.delete(registration)) return;
      if (registeredPoms.size === 0) stopObservingPage();
      notifySubscribers();
    },
  };
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
function rejectSameNamedClasses(PomClass: object, manifest: PomManifest) {
  // A different class with the same name would have its tools hidden by the
  // first one registered.
  for (const registered of registeredPoms)
    if (
      registered.id === manifest.className &&
      registered.pomClass !== PomClass
    )
      throw new RuntimeStateError(
        `Cannot register the Page Object "${manifest.className}": a different class with that name is already registered${declaredIn(registered.manifest, manifest)}. Rename one of them so their tools do not share names.`
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
        throw new RuntimeStateError(
          `Cannot register the Page Object "${manifest.className}": ${
            other.pageObject === manifest.className
              ? `it reaches two different classes named "${node.className}"`
              : `it reaches a class named "${node.className}" that differs from the one the Page Object "${other.pageObject}" reaches`
          }${declaredIn(other.node, node)}. Rename one of them: Ayme tells the classes of Page Objects apart by name.`
        );
      if (!others.some((other) => other.node.file === node.file))
        reached.set(node.className, [...others, { pageObject, node }]);
    }
  };
  for (const registered of registeredPoms)
    reach(registered.id, registered.manifest);
  reach(manifest.className, manifest);
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
  mutationObserver = new MutationObserver(schedulePomMemberProbe);
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  observedWindow = document.defaultView ?? null;
  for (const event of layoutEvents)
    observedWindow?.addEventListener(event, schedulePomMemberProbe, true);
  schedulePomMemberProbe();
}

function stopObservingPage() {
  probeLifetime += 1;
  probeInFlight = undefined;
  probePending = false;
  for (const event of layoutEvents)
    observedWindow?.removeEventListener(event, schedulePomMemberProbe, true);
  observedWindow = null;
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

/** Keeps `registration`'s new observation; whether it found anything new. */
function commitObservation(
  registration: ObservedRegisteredPom,
  { memberObservations, instances }: Awaited<ReturnType<typeof probePomMembers>>
): boolean {
  if (!registeredPoms.has(registration)) return false;
  const previous = registration.instances?.all;
  if (
    previous?.length === instances.length &&
    previous.every((instance, index) =>
      sameInstance(instance, instances[index]!)
    ) &&
    sameObservations(registration.memberObservations, memberObservations)
  )
    return false;
  registration.memberObservations = memberObservations;
  registration.instances = groupedInstances(instances);
  return true;
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

// Capture labels and exclusions from the same completed observation.
export async function getRegisteredPomStructure() {
  await probeRegisteredPomMembers();
  const observations = [...registeredPoms].flatMap((registration) =>
    (registration.instances?.all ?? []).flatMap(({ path, root }) =>
      root
        ? [
            {
              ...root,
              label: path ? `${registration.id}.${path}` : registration.id,
            },
          ]
        : []
    )
  );
  const roots = observations
    .filter(isRootPresent)
    .map(({ label, element }) => ({ label, element }));
  const present = new Set(roots.map((root) => root.element));
  const absentElements = [
    ...new Set(
      observations.flatMap((root) =>
        !root.present && root.element?.isConnected && !present.has(root.element)
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
          availabilityOf(instance, tool.methodName)
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
    return instance.item && root && isRootPresent(root)
      ? [
          {
            label: `${registration.id}.${instance.item.path}`,
            element: root.element,
            ...availabilityOf(instance, tool.methodName),
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
    registration.instances?.all.some((instance) => instance.root?.obstruction)
  );
  if (obstructed) notifySubscribers();
}

function createRegisteredTools(registration: ObservedRegisteredPom) {
  const { manifest, instance } = registration;
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
    return createComponentTools(registration, [member], component, components);
  });
  return [...pageTools, ...componentTools];
}

function createRegisteredTool(
  pomId: string,
  instance: object,
  tool: ToolManifest
): CallerAwarePomTool {
  return {
    pomId,
    methodName: tool.methodName,
    name: tool.toolName,
    description: toolDescription(tool),
    inputSchema: inputSchemaFor(tool.parameters),
    parameters: inputParameters(tool.parameters),
    execute: (args, { cursor }) =>
      performPageObjectAction(instance, tool, args, cursor),
  };
}

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
  const { id: pomId, instance: pageInstance } = registration;
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
  const itemDepth = path.map((member) => member.collection).lastIndexOf(true);
  const execute: CallerAwarePomTool["execute"] = async (input, { cursor }) => {
    const values = validatedArguments(wrapper, input);
    const ref = requireStructuralRef(values[0] as string);
    const args = values[1] ?? {};
    const toolPath = `${pomId}.${publicComponentPath(path)}`;
    const element = await resolveRefToElement(ref, wrapper.toolName, toolPath);
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
    // An item the last observation did not find is not on the page yet.
    const item = collectionItemsOf(registration, tool).find(
      (candidate) => candidate.element === element
    );
    assertAvailable(tool.name, item ?? { present: false, available: false });
    return await performPageObjectAction(
      componentInstance,
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
    description: toolDescription(action),
    inputSchema: inputSchemaFor(wrapper.parameters),
    parameters: wrapper.parameters,
    execute,
  };
  return tool;
}

function createSingularComponentTool(
  pomId: string,
  pageInstance: object,
  path: readonly PomComponentMemberManifest[],
  component: PomComponentManifest,
  action: ToolManifest,
  componentPath: string
): CallerAwarePomTool {
  const execute: CallerAwarePomTool["execute"] = async (input, { cursor }) => {
    const componentInstance = await resolveSingularComponent(
      pageInstance,
      path
    );
    if (!componentInstance || !isRecord(componentInstance)) {
      throw new RefResolutionError(
        `No ${component.className} instance exists at ${pomId}.${publicComponentPath(path)}.`
      );
    }
    return await performPageObjectAction(
      componentInstance,
      action,
      input,
      cursor
    );
  };
  return {
    pomId,
    componentClassName: component.className,
    componentPath,
    methodName: action.methodName,
    name: `${pomId}.${publicComponentPath(path)}.${action.methodName}`,
    description: toolDescription(action),
    inputSchema: inputSchemaFor(action.parameters),
    parameters: inputParameters(action.parameters),
    execute,
  };
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

/**
 * The element a collection tool's ref names now. A synthetic ref resolves
 * too: a Page Object Root without a role of its own gets one in snapshot.
 */
async function resolveRefToElement(
  ref: AriaRef,
  toolName: string,
  toolPath: string
): Promise<Element> {
  const resolution = (await resolvePageStateRefs(document, ref))[0]!;
  if (resolution.status === "unresolved")
    throw new RefResolutionError(
      `Ref "${ref}" does not match a present instance at ${toolPath} (tool ${toolName}): ${resolution.reason}.`
    );
  return resolution.node.element;
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
  const { instance, manifest } = registration;
  const walk: Walk = {
    components: new Map(
      manifest.components.map((component) => [component.className, component])
    ),
    instances: [],
  };
  const rootMember = manifest.members.find(isRootMember);
  // A rootless Page Object is on every page.
  const root = rootMember
    ? await observeDeclaredRoot(instance, rootMember)
    : undefined;
  walk.instances.push({
    path: "",
    componentPath: undefined,
    item: undefined,
    root,
    predicates:
      root === undefined || root.present
        ? await askPredicates(instance, manifest.tools)
        : new Map(),
  });
  const memberObservations = await probeMembers(
    walk,
    instance,
    manifest.members,
    { path: "", componentPath: "", item: undefined },
    new Set()
  );
  return { memberObservations, instances: walk.instances };
}

/** One walk over a registered Page Object's members. */
type Walk = {
  components: ReadonlyMap<string, PomComponentManifest>;
  /** Every instance the walk found, parents before their members. */
  instances: PomInstanceObservation[];
};

/** Where in the walk an instance's members are. */
type Place = Pick<PomInstanceObservation, "path" | "item"> & {
  componentPath: string;
};

/**
 * Observes the page's declared root. A missing or invalid declared root
 * never falls back to rootless activation: it is absent.
 */
async function observeDeclaredRoot(
  instance: object,
  rootMember: PomMemberManifest
): Promise<ObservedPomRoot> {
  try {
    const root = await readMember(instance, rootMember);
    if (isLocator(root)) return (await observeRoot(root)).root;
  } catch {
    // A root that cannot be read is not on the page.
  }
  return absentRoot;
}

const absentRoot: ObservedPomRoot = {
  element: undefined,
  present: false,
  available: false,
  obstruction: undefined,
};

async function observeRoot(
  locator: Locator
): Promise<{ count: number; root: ObservedPomRoot }> {
  const count = await locator.count();
  const elements = locatorElements(locator);
  const element =
    count === 1 && elements.length === 1 ? elements[0] : undefined;
  const state =
    element === undefined
      ? { present: false, available: false }
      : await observePomRoot(locator);
  const current = locatorElements(locator);
  const sameElement = current.length === 1 && current[0] === element;
  const present = sameElement && state.present;
  const available = sameElement && state.available;
  return {
    count,
    root: {
      element: sameElement ? element : undefined,
      present,
      available,
      obstruction: present && !available ? state.obstruction : undefined,
    },
  };
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
        if (!isLocator(value)) continue;
        const locator = value.toString();
        for (const element of locatorElements(value))
          targets.push({ path: memberPath, element, locator });
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
        const locator = candidate.root.toString();
        for (const element of locatorElements(candidate.root))
          targets.push({ path: `${componentPath}.root`, element, locator });
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
      if (member.kind === "locator")
        observations.push(await observeLocator(value, member, memberPath));
      else
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
    if (!isPomComponent(component)) {
      observations.push({
        memberName: `${path}.root`,
        kind: "component-root",
        count: 0,
        error: `POM component ${path} does not expose a browser locator root.`,
      });
      continue;
    }
    const { count, root } = await observeRoot(component.root);
    observations.push({
      memberName: `${path}.root`,
      kind: "component-root",
      count,
    });
    const observed: PomInstanceObservation = {
      path,
      componentPath,
      item: place.item,
      root,
      predicates: root.present
        ? await askPredicates(component, manifest.tools)
        : new Map(),
    };
    if (member.collection) observed.item = observed;
    walk.instances.push(observed);
    observations.push(
      ...(await probeMembers(
        walk,
        component,
        manifest.members.filter((child) => !isRootMember(child)),
        { path, componentPath, item: observed.item },
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

function isRootMember(member: PomMemberManifest) {
  return member.kind === "locator" && member.memberName === "root";
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

/** Performs a Page Object Action for a Run whose Change Record is read from `cursor`. */
async function performPageObjectAction(
  instance: object,
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
  throwFirstViolation(
    toolInputViolations(inputSchemaFor(tool.parameters), args)
  );
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

function isPomComponent(value: unknown): value is { root: Locator } {
  return isRecord(value) && isLocator(value.root);
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
