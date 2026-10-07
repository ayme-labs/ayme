/**
 * Ayme page object actions as e2e project tools.
 *
 * Each `@ayme.action` of a top-level page object in the files becomes one
 * tool, named `Class_method` (model providers allow `[a-zA-Z0-9_-]` only).
 * Executing it constructs the page object on the engine's live Playwright
 * page and calls the method with the arguments in parameter order. A Page
 * Object Child publishes its actions under its parent's path in Ayme, so a
 * class another one holds as a child is not offered on its own.
 */

import { pathToFileURL } from "node:url";
import type {
  PomComponentManifest,
  PomComponentMemberManifest,
  PomManifest,
  ToolManifest,
} from "@ayme-dev/ayme";
import { derivePomManifests } from "@ayme-dev/unplugin-ayme";
import { surfaceOf, type web } from "@e2e-dev/web";
import { jsonSchema, tool, type JSONSchema7 } from "ai";
import { defineTool } from "e2e/agent";

type Engine = ReturnType<typeof web>;
type PageObjectClass = new (
  page: unknown
) => Record<string, (...args: unknown[]) => Promise<unknown>>;

/** A page object tool: what e2e and our executor need to run it. */
export type PageObjectTool = ReturnType<typeof defineTool>;
export type PageObjectTools = Record<string, PageObjectTool>;

/** The web engine's context default timeout, restored after a call that shortened it. */
const ENGINE_DEFAULT_TIMEOUT_MS = 30_000;

/** Execution options a caller may extend: `aymeTimeoutMs` bounds every locator wait of the call. */
export interface PageObjectCallOptions {
  readonly aymeTimeoutMs?: number;
}

/** Runs one page object tool's `execute`, the way both the model's call and a stored replay do. */
export function executePageObjectTool(
  defined: PageObjectTool,
  args: unknown,
  options: PageObjectCallOptions = {}
): Promise<unknown> {
  const { execute } = defined.tool as {
    execute: (input: unknown, options: unknown) => Promise<unknown>;
  };
  return execute(args, {
    toolCallId: "ayme",
    messages: [],
    context: undefined,
    ...options,
  });
}

/** One page object tool to offer: the action and the member path from the page object instance to the object that has it. */
interface OfferedAction {
  /** Ayme's tool name: `Class.member.path.method`. */
  readonly toolName: string;
  readonly action: ToolManifest;
  readonly path: readonly PomComponentMemberManifest[];
}

/**
 * The actions a top-level page object offers, as Ayme publishes them: its
 * own, and those of every Page Object Child reached through singular
 * component members, named by the member path (`Inspector.navigator.showLens`).
 * Collections are left out: a collection tool needs a Structural Ref to pick
 * the instance, which Node has no source for yet.
 */
function offeredActions(manifest: PomManifest): OfferedAction[] {
  const components = new Map(
    manifest.components.map((component) => [component.className, component])
  );
  const own = manifest.tools.map((action) => ({
    toolName: action.toolName,
    action,
    path: [],
  }));
  const nested = (
    path: readonly PomComponentMemberManifest[],
    component: PomComponentManifest,
    seen: ReadonlySet<string>
  ): OfferedAction[] => {
    if (seen.has(component.className)) return [];
    const nextSeen = new Set(seen).add(component.className);
    const prefix = [manifest.className, ...path.map((m) => m.memberName)].join(
      "."
    );
    const tools = component.tools.map((action) => ({
      toolName: `${prefix}.${action.methodName}`,
      action,
      path,
    }));
    return [...tools, ...children(path, component.members, nextSeen)];
  };
  const children = (
    path: readonly PomComponentMemberManifest[],
    members: PomManifest["members"],
    seen: ReadonlySet<string>
  ): OfferedAction[] =>
    members.flatMap((member) => {
      if (member.kind !== "component" || member.collection) return [];
      const component = components.get(member.componentClassName);
      return component ? nested([...path, member], component, seen) : [];
    });
  return [...own, ...children([], manifest.members, new Set())];
}

/** Follows a member path from the page object to the child that has the action: a field or getter is read, a method is called. */
async function resolveTarget(
  pageObject: Record<string, unknown>,
  path: readonly PomComponentMemberManifest[]
): Promise<Record<string, (...args: unknown[]) => Promise<unknown>>> {
  let target: unknown = pageObject;
  for (const member of path) {
    const value = (target as Record<string, unknown>)[member.memberName];
    target =
      member.access === "method"
        ? await (value as () => unknown).call(target)
        : value;
    if (target === null || typeof target !== "object")
      throw new Error(
        `no ${member.componentClassName} at .${member.memberName}`
      );
  }
  return target as Record<string, (...args: unknown[]) => Promise<unknown>>;
}

/** What the availability check needs of a root locator. */
interface RootLocator {
  count(): Promise<number>;
  first(): {
    isVisible(): Promise<boolean>;
    evaluate<R>(fn: (element: Element) => R): Promise<R>;
  };
}

/**
 * Whether a root is present and available, approximating Ayme's rule in
 * Node: attached and visible, and not covered, so the element at its centre
 * is the root or inside it (a modal over the page takes that point). A root
 * whose centre is outside the viewport counts as available: scrolled away
 * is not blocked.
 */
async function rootAvailable(root: RootLocator): Promise<boolean> {
  try {
    if ((await root.count()) === 0 || !(await root.first().isVisible()))
      return false;
    return await root.first().evaluate((element) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight)
        return true;
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === element || element.contains(hit));
    });
  } catch {
    return false;
  }
}

/**
 * Which page object tools are live on the current page, by Ayme's rule: a
 * page object with a `root` member is live while that root is present and
 * available (`rootAvailable`); one without a root is live while it is
 * registered. One visibility check per
 * rooted class, all at once, per call.
 */
export function aymeAvailability({
  engine,
  files,
}: {
  engine: Engine;
  files: readonly string[];
}): () => Promise<ReadonlySet<string>> {
  const classes = files.flatMap((file) => {
    const manifests = derivePomManifests(file);
    const children = new Set(
      manifests.flatMap((manifest) =>
        manifest.components.map((component) => component.className)
      )
    );
    return manifests
      .filter((manifest) => !children.has(manifest.className))
      .map((manifest) => ({
        file,
        className: manifest.className,
        rooted: manifest.members.some(
          (member) => member.memberName === "root" && member.kind === "locator"
        ),
        tools: offeredActions(manifest).map(({ toolName }) =>
          toolName.replaceAll(".", "_")
        ),
      }));
  });
  return async () => {
    const surface = surfaceOf(engine);
    if (surface === undefined)
      return new Set(classes.flatMap((entry) => entry.tools));
    const page = surface.page();
    const live = await Promise.all(
      classes.map(async (entry) => {
        if (!entry.rooted) return true;
        const module = (await import(pathToFileURL(entry.file).href)) as Record<
          string,
          PageObjectClass
        >;
        const root = (
          new module[entry.className]!(page) as unknown as { root: RootLocator }
        ).root;
        return rootAvailable(root);
      })
    );
    return new Set(
      classes.flatMap((entry, index) => (live[index] ? entry.tools : []))
    );
  };
}

export function aymeTools({
  engine,
  files,
}: {
  engine: Engine;
  files: readonly string[];
}): PageObjectTools {
  const tools: PageObjectTools = {};
  for (const file of files) {
    const manifests = derivePomManifests(file);
    const children = new Set(
      manifests.flatMap((manifest) =>
        manifest.components.map((component) => component.className)
      )
    );
    for (const manifest of manifests.filter(
      (candidate) => !children.has(candidate.className)
    )) {
      for (const { toolName, action, path } of offeredActions(manifest)) {
        tools[toolName.replaceAll(".", "_")] = defineTool(
          tool({
            description: action.description,
            inputSchema: jsonSchema(action.inputSchema as JSONSchema7),
            execute: async (
              input: Record<string, unknown>,
              options: object
            ) => {
              const surface = surfaceOf(engine);
              if (surface === undefined)
                throw new Error("aymeTools needs a web() engine");
              const page = surface.page();
              const module = (await import(pathToFileURL(file).href)) as Record<
                string,
                PageObjectClass
              >;
              const PageObject = module[manifest.className];
              if (PageObject === undefined)
                throw new Error(
                  `${file} does not export ${manifest.className}`
                );
              const pageObject = new PageObject(page);
              const target = await resolveTarget(pageObject, path);
              const timeoutMs = (options as PageObjectCallOptions | undefined)
                ?.aymeTimeoutMs;
              if (timeoutMs !== undefined) page.setDefaultTimeout(timeoutMs);
              try {
                await target[action.methodName]!(
                  ...action.parameters.map((parameter) => input[parameter.name])
                );
              } finally {
                if (timeoutMs !== undefined)
                  page.setDefaultTimeout(ENGINE_DEFAULT_TIMEOUT_MS);
              }
              return `${toolName} done`;
            },
          }),
          { mutates: true }
        );
      }
    }
  }
  return tools;
}
