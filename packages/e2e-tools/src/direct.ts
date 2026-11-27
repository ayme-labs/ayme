/**
 * Page Objects written on e2e's `screen`, offered as tools, without ayme's
 * runtime.
 *
 * Nothing here starts an ayme session or adds anything to the page. The tool
 * list comes from the manifests ayme's compiler derives from the Page Object
 * source, so it is known before any page exists: one tool per Page Object
 * Action of each class the entry file lists and of every class it holds as a
 * Page Object Child, however deep. A call builds the listed class on the
 * newest attempt's `screen` (the patched e2e keeps it), walks the members to
 * the part the action belongs to, and calls the method: the Page Object's
 * own calls through e2e's engine, and nothing else.
 *
 * Before a call, its input is checked against the action's schema, as an
 * ayme session checks it, live or replayed, and the rules the Page Object
 * itself declares are asked in Node: its presence rule, whether its root
 * shows, and the action's availability rule. A call they rule out is refused
 * at once with the reason. That is less than an ayme session measures: it
 * does not check that a click would reach the element.
 *
 * An item of a collection would need input that names it, which no study
 * Page Object has, so the actions of a collection's items are left out.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPomCompiler } from "@ayme-dev/ayme/compiler";
import {
  availabilityPredicateOf,
  inputSchemaFor,
  methodArguments,
  modelOption,
  patternViolations,
} from "@ayme-dev/ayme/internal";
import type { JsonValue } from "e2e";
import { defineTool, type DefinedTool } from "e2e/agent";
import { z } from "zod";
import { patchedScreens } from "./patched";

type Manifest = ReturnType<
  ReturnType<typeof createPomCompiler>["derivePomManifests"]
>[number];
type Component = Manifest["components"][number];
type Parameter = Component["tools"][number]["parameters"][number];

/** One member on the way from the listed class to the part an action belongs to. */
interface Step {
  readonly member: string;
  /** A getter reads like a field. */
  readonly access: "field" | "getter" | "method";
}

interface Bound {
  /** `Class.method`, or `Parent.member.method` when the class sits in more than one place. */
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the input, as an ayme session builds it from the action's parameters. */
  readonly inputSchema: object;
  /** The members from the listed class to the action's part, as code: `navigator.model`. */
  readonly path: string;
  /** The file that declares the class the action belongs to. */
  readonly sourceFile: string;
  readonly className: string;
  readonly rootClass: string;
  readonly steps: readonly Step[];
  readonly methodName: string;
  readonly parameters: readonly Parameter[];
}

/** Where a tool's action is written, for a note on a stale Page Object. */
export interface ToolSource {
  readonly className: string;
  readonly methodName: string;
  /** The members from the listed class to the action's part, as code. */
  readonly path: string;
  /** The file that declares the class. */
  readonly file: string;
}

/** A Page Object class the entry file lists. */
type PageObjectClass = new (...args: never[]) => object;

/**
 * Builds a listed class on the attempt's `screen` and its other fixtures,
 * such as the web engine's `browser`. Asked again for every call, so it
 * follows the tabs the test has open.
 */
export type Build = (
  PageObject: PageObjectClass,
  fixtures: { readonly screen: object; readonly [name: string]: unknown }
) => object | Promise<object>;

/** A call the Page Object's own rules ruled out, before anything ran. */
export class NotAvailable extends Error {
  readonly tool: string;
  readonly reason: string;
  constructor(tool: string, reason: string) {
    super(`${tool} cannot run now: ${reason}`);
    this.tool = tool;
    this.reason = reason;
  }
}

/**
 * Whether `error` is, or was caused by, a refusal of the Page Object's own
 * rules: e2e's tool accounting may wrap what a call threw.
 */
export function isNotAvailable(error: unknown): boolean {
  for (let at = error, depth = 0; at !== undefined && depth < 8; depth += 1) {
    if (at instanceof NotAvailable) return true;
    at = at instanceof Error ? at.cause : undefined;
  }
  return false;
}

/** The e2e tool name of an action: model providers allow `[a-zA-Z0-9_-]` only. */
const toolName = (actionName: string): string =>
  actionName.replaceAll(".", "_");

/**
 * Why `methodName` cannot run on `target` now, by the rules its class
 * declares; undefined when they allow it. A rule that throws rules the call
 * out, with the error as the reason, as in ayme's own session.
 */
async function ruledOut(
  target: object,
  methodName: string
): Promise<string | undefined> {
  const first = (error: unknown) =>
    String(error instanceof Error ? error.message : error).split("\n")[0] ?? "";
  const present = modelOption(target.constructor, "present");
  if (present !== undefined) {
    const answer = await Promise.resolve()
      .then(() => present(target as never))
      .catch(first);
    if (answer !== true)
      return typeof answer === "string"
        ? answer
        : `${target.constructor.name} is not on the page`;
  }
  const root = modelOption(target.constructor, "root");
  if (root !== undefined) {
    const showing = await Promise.resolve()
      .then(() => root(target as never))
      .then((locator) => locator.first().isVisible())
      .catch(first);
    if (showing !== true)
      return typeof showing === "string"
        ? showing
        : `${target.constructor.name} is not showing on the page`;
  }
  const prototype = Object.getPrototypeOf(target) as Record<
    string,
    unknown
  > | null;
  const available =
    availabilityPredicateOf(prototype?.[methodName]) ??
    availabilityPredicateOf((target as Record<string, unknown>)[methodName]);
  if (available !== undefined) {
    const answer = await Promise.resolve()
      .then(() => available(target as never))
      .catch(first);
    if (answer !== true)
      return typeof answer === "string" && answer !== ""
        ? answer
        : "its Page Object says it is not available now";
  }
  return undefined;
}

interface DirectPageObjects {
  /**
   * The tools as e2e config tools, named as `toolName` spells them, each
   * marked `repeatable`: the patched e2e records a call with its input and a
   * cached replay runs it again.
   */
  projectTools(): Record<string, DefinedTool>;
  /** Why a tool's action cannot run on the screen now; undefined when it can. */
  ruledOutNow(name: string): Promise<string | undefined>;
  /** Where a tool's action is written, by the tool's name in either spelling. */
  sourceOf(name: string): ToolSource | undefined;
}

export function directPageObjects(options: {
  /**
   * A file whose default export is the array of Page Object classes, written
   * on e2e's `screen`, declared there or imported from other files, as
   * `ayme mcp --page-objects` takes it. Absolute.
   */
  readonly entry: string;
  /** How a listed class is built; `new PageObject(screen, browser)` when left out. */
  readonly build?: Build;
}): DirectPageObjects {
  const { entry } = options;
  const build: Build =
    options.build ??
    ((PageObject, { screen, browser }) =>
      new (PageObject as new (screen: unknown, browser: unknown) => object)(
        screen,
        browser
      ));
  const bound = new Map<string, Bound>();
  for (const tool of deriveEntryTools(entry)) bound.set(tool.name, tool);

  // The patched e2e keeps the version of the Page Object source with each
  // call it records, so a replay can tell when the Page Objects changed since.
  // The source does not change during a run, so it is read once.
  let version: string | undefined;
  (globalThis as Record<symbol, unknown>)[
    Symbol.for("e2e.patch.toolSourceVersion")
  ] = () => (version ??= sourceVersion([...bound.values()], entry));

  const screens = () => {
    const kept = patchedScreens();
    if (kept === undefined)
      throw new Error(
        "no e2e screen: Page Objects on `screen` need the patched e2e, which keeps each attempt's"
      );
    return kept;
  };

  let entryModule: Promise<Record<string, unknown>> | undefined;
  const rootOf = async (tool: Bound) => {
    const { current, fixtures } = screens();
    const exports = await (entryModule ??= import(
      pathToFileURL(entry).href
    ) as Promise<Record<string, unknown>>);
    const listed = Array.isArray(exports.default)
      ? (exports.default as PageObjectClass[])
      : [];
    const PageObject = listed.find((Class) => Class.name === tool.rootClass);
    if (PageObject === undefined)
      throw new Error(`${entry} does not list ${tool.rootClass}`);
    return build(PageObject, {
      ...fixtures,
      screen: current,
      ...(fixtures.browser === undefined
        ? {}
        : { browser: countingActions(fixtures.browser as object) }),
    });
  };

  const toolNamed = (name: string): Bound => {
    const tool =
      bound.get(name) ??
      [...bound.values()].find((listed) => toolName(listed.name) === name);
    if (tool === undefined) throw new Error(`no Page Object Tool ${name}`);
    return tool;
  };

  /** The part of the Page Object a tool's action belongs to. */
  const targetOf = async (tool: Bound): Promise<Record<string, unknown>> => {
    let target = (await rootOf(tool)) as Record<string, unknown>;
    for (const step of tool.steps) {
      const member = target[step.member];
      target = (
        step.access === "method"
          ? await (member as () => unknown).call(target)
          : member
      ) as Record<string, unknown>;
    }
    return target;
  };

  /**
   * Every call, live, replayed or scripted, comes through here: the input is
   * checked before anything runs, so a recorded input the action no longer
   * takes fails at once instead of acting on part of it.
   */
  const run = async (name: string, input: JsonValue): Promise<unknown> => {
    const tool = toolNamed(name);
    const args = checkedInput(tool, input);
    const target = await targetOf(tool);
    const reason = await ruledOut(target, tool.methodName);
    if (reason !== undefined) throw new NotAvailable(tool.name, reason);
    const method = target[tool.methodName] as (...a: unknown[]) => unknown;
    return method.apply(target, methodArguments(tool.parameters, args));
  };

  return {
    ruledOutNow(name) {
      const tool = toolNamed(name);
      return targetOf(tool).then(
        (target) => ruledOut(target, tool.methodName),
        (error: unknown) => String(error).split("\n")[0]
      );
    },
    sourceOf(name) {
      const tool = [...bound.values()].find(
        (listed) => listed.name === name || toolName(listed.name) === name
      );
      return tool === undefined
        ? undefined
        : {
            className: tool.className,
            methodName: tool.methodName,
            path: tool.path,
            file: tool.sourceFile,
          };
    },
    projectTools() {
      return Object.fromEntries(
        [...bound.values()].map((tool) => [
          toolName(tool.name),
          defineTool(
            {
              description: tool.description,
              inputSchema: z.fromJSONSchema(
                tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]
              ),
              execute: async (input: JsonValue) =>
                `${toolName(tool.name)} ran${returned(await run(tool.name, input))}.`,
            } as unknown as Parameters<typeof defineTool>[0],
            // `repeatable` is the patched e2e's annotation (`patched.ts`).
            { mutates: true, repeatable: true } as Parameters<
              typeof defineTool
            >[1]
          ),
        ])
      );
    },
  };
}

/**
 * The tools of an entry file's Page Objects. The compiler derives the classes
 * a file declares, so the files the entry imports by a relative path are
 * read as well, and the classes its default export lists are kept.
 */
function deriveEntryTools(entry: string): Bound[] {
  const listed = /export\s+default\s*\[([^\]]*)\]/.exec(
    readFileSync(entry, "utf8")
  )?.[1];
  if (listed === undefined)
    throw new Error(
      `${entry} has no default export written as an array of Page Object classes`
    );
  const names = new Set(
    listed
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "")
  );
  const files: string[] = [];
  const visit = (file: string) => {
    if (files.includes(file) || file.includes("/node_modules/")) return;
    files.push(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(
      /from\s+["'](\.{1,2}\/[^"']+)["']/g
    )) {
      const base = path.resolve(path.dirname(file), specifier ?? "");
      const found = [base, `${base}.ts`, path.join(base, "index.ts")].find(
        (candidate) => existsSync(candidate) && /\.[cm]?tsx?$/.test(candidate)
      );
      if (found !== undefined) visit(found);
    }
  };
  visit(entry);
  return deriveTools(files, names);
}

/** Every action reachable from the listed classes of `files` through Page Object Child members. */
function deriveTools(
  files: readonly string[],
  only: ReadonlySet<string>
): Bound[] {
  const compiler = createPomCompiler({ include: true });
  const found: (Omit<Bound, "name"> & { parent: string })[] = [];
  for (const file of files) {
    for (const manifest of compiler.derivePomManifests(file)) {
      if (!only.has(manifest.className)) continue;
      const classes = new Map<string, Component>([
        [manifest.className, manifest],
        ...manifest.components.map((component): [string, Component] => [
          component.className,
          component,
        ]),
      ]);
      const walk = (
        component: Component,
        steps: readonly Step[],
        parent: string,
        onWay: readonly string[]
      ) => {
        for (const action of component.tools) {
          const membersPath = steps.map((step) => step.member).join(".");
          found.push({
            className: component.className,
            parent,
            // The listed class carries its file; a part that names none shares it.
            sourceFile: component.file ?? file,
            rootClass: manifest.className,
            steps,
            methodName: action.methodName,
            parameters: action.parameters,
            path: membersPath,
            description: `${action.description ?? `Page Object Tool ${action.toolName}.`}${membersPath === "" ? "" : ` (${manifest.className}'s ${membersPath})`}`,
            inputSchema: inputSchemaFor(action.parameters),
          });
        }
        for (const member of component.members) {
          // An item of a collection is named by no input here: its actions are left out.
          if (member.kind !== "component" || member.collection) continue;
          const child = classes.get(member.componentClassName);
          // A class that holds itself, directly or not, is followed once.
          if (child === undefined || onWay.includes(child.className)) continue;
          walk(
            child,
            [...steps, { member: member.memberName, access: member.access }],
            `${component.className}.${member.memberName}`,
            [...onWay, child.className]
          );
        }
      };
      walk(manifest, [], "", [manifest.className]);
    }
  }
  const places = new Map<string, number>();
  for (const tool of found) {
    const key = `${tool.className}.${tool.methodName}`;
    places.set(key, (places.get(key) ?? 0) + 1);
  }
  return found.map(({ parent, ...tool }) => ({
    ...tool,
    name:
      (places.get(`${tool.className}.${tool.methodName}`) ?? 0) > 1
        ? `${parent}.${tool.methodName}`
        : `${tool.className}.${tool.methodName}`,
  }));
}

/**
 * The input as the action's arguments by name, once it holds to the action's
 * schema and to the rule a defaulted pattern keeps beside it, as an ayme
 * session checks it; a call that does not is refused before anything runs.
 */
function checkedInput(tool: Bound, input: JsonValue): Record<string, unknown> {
  const parsed = schemaOf(tool).safeParse(input ?? {});
  const problems = parsed.success
    ? patternViolations(tool.parameters, parsed.data).map(
        ({ path: at, message }: { path: string; message: string }) =>
          `${at} ${message}`
      )
    : parsed.error.issues.map(
        ({ path: at, message }) => `${at.join(".") || "input"}: ${message}`
      );
  if (!parsed.success || problems.length > 0)
    throw new Error(
      `${tool.name} was called with input it does not take: ${problems.join("; ")}`
    );
  return parsed.data;
}

const schemas = new WeakMap<Bound, z.ZodType<Record<string, unknown>>>();

/** The tool's input schema as zod reads it, built once per tool. */
function schemaOf(tool: Bound): z.ZodType<Record<string, unknown>> {
  let schema = schemas.get(tool);
  if (schema === undefined) {
    schema = z.fromJSONSchema(
      tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]
    ) as z.ZodType<Record<string, unknown>>;
    schemas.set(tool, schema);
  }
  return schema;
}

/** What the action returned, when it is a plain value. */
function returned(result: unknown): string {
  if (result === undefined || result === null || typeof result === "object")
    return "";
  return ` and returned ${JSON.stringify(result)}`;
}

/** One digest of every source file the Page Objects' actions are written in. */
function sourceVersion(tools: readonly Bound[], entry: string): string {
  const hash = createHash("sha256");
  const files = [
    ...new Set(tools.map((tool) => onDisk(tool.sourceFile, entry))),
  ];
  for (const file of files.sort()) {
    hash.update(file);
    hash.update(existsSync(file) ? readFileSync(file) : "");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * A source file as ayme names it, `<package>@<version>/<path>`, on disk: the
 * package found from the entry's folder up, as its own package.json or under
 * node_modules. A name that is already a path is returned as it is.
 */
function onDisk(named: string, from: string): string {
  const qualified = /^((?:@[^/]+\/)?[^/@]+)@[^/]+\/(.+)$/.exec(named);
  if (qualified === null) return named;
  const [, name, rest] = qualified as unknown as [string, string, string];
  for (let dir = path.dirname(from); ; dir = path.dirname(dir)) {
    const own = path.join(dir, "package.json");
    if (
      existsSync(own) &&
      (JSON.parse(readFileSync(own, "utf8")) as { name?: string }).name === name
    )
      return path.join(dir, rest);
    const linked = path.join(dir, "node_modules", name);
    if (existsSync(linked)) return path.join(realpathSync(linked), rest);
    if (path.dirname(dir) === dir) return named;
  }
}

/** The members of e2e's web `browser` fixture that only read; any other call may change the page. */
const BROWSER_READS = new Set([
  "url",
  "title",
  "waitForURL",
  "locator",
  "frameLocator",
  "tabs",
  "cookies",
  "waitForResponse",
]);

/** Counts a page action toward the patched e2e's count, as its engine does for `screen`'s. */
const countPageAction = () => {
  const key = Symbol.for("e2e.patch.pageActions");
  const counts = globalThis as Record<symbol, number | undefined>;
  counts[key] = (counts[key] ?? 0) + 1;
};

/**
 * The web engine's `browser` fixture, counting each call that may change the
 * page before it runs, keyboard and mouse included. Its locators act through
 * e2e's engine, which counts their actions itself; `evaluate` counts, since
 * page code can change anything. The patched e2e tells from the count whether
 * a failed call left the page as it found it.
 */
function countingActions(browser: object): object {
  const counting = (target: object, all: boolean): object =>
    new Proxy(target, {
      get(object, member, receiver) {
        const value: unknown = Reflect.get(object, member, receiver);
        if (typeof member !== "string") return value;
        if (typeof value === "function") {
          if (!all && BROWSER_READS.has(member)) return value.bind(object);
          return (...args: unknown[]) => {
            countPageAction();
            return (value as (...a: unknown[]) => unknown).apply(object, args);
          };
        }
        // keyboard, mouse and webmcp: every call of theirs counts.
        if (value !== null && typeof value === "object" && !all)
          return counting(value, true);
        return value;
      },
    });
  return counting(browser, false);
}
