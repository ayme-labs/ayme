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
 * Before a call, the rules the Page Object itself declares are asked in
 * Node: its presence rule, whether its root shows, and the action's
 * availability rule. A call they rule out is refused at once with the
 * reason. That is less than an ayme session measures: it does not check that
 * a click would reach the element.
 *
 * Nothing lists the items of a collection, so an action of an item takes
 * text the item shows (`{ item, args }`) and runs on the one item that shows
 * it. Unlike a position, that text names the same item in a later run, so
 * e2e can record the call and repeat it.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPomCompiler } from "@ayme-dev/ayme/compiler";
import { availabilityPredicateOf, modelOption } from "@ayme-dev/ayme/internal";
import type { JsonValue } from "e2e";
import { defineTool, type DefinedTool } from "e2e/agent";
import { z } from "zod";
import { patchedScreens } from "./patched";

type Manifest = ReturnType<
  ReturnType<typeof createPomCompiler>["derivePomManifests"]
>[number];
type Component = Manifest["components"][number];
type NamedParameter = Extract<
  Component["tools"][number]["parameters"][number],
  { name: string }
>;

/** One member on the way from the listed class to the part an action belongs to. */
interface Step {
  readonly member: string;
  /** A getter reads like a field. */
  readonly access: "field" | "getter" | "method";
  readonly collection: boolean;
}

export interface DirectTool {
  /** `Class.method`, or `Parent.member.method` when the class sits in more than one place. */
  readonly name: string;
  readonly description: string;
  /** JSON Schema of the input: the action's parameters, or `{ item, args }` for an item of a collection. */
  readonly inputSchema: object;
  /** Whether the action belongs to an item of a collection, picked by text it shows. */
  readonly collection: boolean;
  /** The members from the listed class to the action's part, as code: `navigator.model`. */
  readonly path: string;
}

interface Bound extends DirectTool {
  /** The file that declares the class the action belongs to. */
  readonly sourceFile: string;
  readonly className: string;
  readonly rootClass: string;
  readonly steps: readonly Step[];
  readonly methodName: string;
  readonly parameters: readonly NamedParameter[];
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
export type PageObjectClass = new (...args: never[]) => object;

/** Builds a listed class on the attempt's `screen` and its other fixtures, such as the web engine's `browser`. */
export type Build = (
  PageObject: PageObjectClass,
  fixtures: { readonly screen: object; readonly [name: string]: unknown }
) => object;

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

/** The e2e tool name of an action: model providers allow `[a-zA-Z0-9_-]` only. */
export const toolName = (actionName: string): string =>
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
    const answer = await Promise.resolve(present(target as never)).catch(first);
    if (answer !== true)
      return typeof answer === "string"
        ? answer
        : `${target.constructor.name} is not on the page`;
  }
  const root = modelOption(target.constructor, "root");
  if (root !== undefined) {
    const showing = await Promise.resolve(root(target as never))
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
    const answer = await Promise.resolve(available(target as never)).catch(
      first
    );
    if (answer !== true)
      return typeof answer === "string" && answer !== ""
        ? answer
        : "its Page Object says it is not available now";
  }
  return undefined;
}

export interface DirectPageObjects {
  /** Every tool, as derived from the source. */
  readonly tools: readonly DirectTool[];
  /** Calls the Page Object method behind `name` (either spelling) on the newest attempt's screen. */
  run(name: string, input: JsonValue): Promise<unknown>;
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

  const screens = () => {
    const kept = patchedScreens();
    if (kept === undefined)
      throw new Error(
        "no e2e screen: Page Objects on `screen` need the patched e2e, which keeps each attempt's"
      );
    return kept;
  };

  let entryModule: Promise<Record<string, unknown>> | undefined;
  const roots = new WeakMap<object, Map<string, object>>();
  const rootOf = async (tool: Bound) => {
    const { current, fixtures } = screens();
    let built = roots.get(current);
    if (built === undefined) roots.set(current, (built = new Map()));
    let root = built.get(tool.rootClass);
    if (root === undefined) {
      const exports = await (entryModule ??= import(
        pathToFileURL(entry).href
      ) as Promise<Record<string, unknown>>);
      const listed = Array.isArray(exports.default)
        ? (exports.default as PageObjectClass[])
        : [];
      const PageObject = listed.find((Class) => Class.name === tool.rootClass);
      if (PageObject === undefined)
        throw new Error(`${entry} does not list ${tool.rootClass}`);
      root = build(PageObject, { ...fixtures, screen: current });
      built.set(tool.rootClass, root);
    }
    return root;
  };

  const toolNamed = (name: string): Bound => {
    const tool =
      bound.get(name) ??
      [...bound.values()].find((listed) => toolName(listed.name) === name);
    if (tool === undefined) throw new Error(`no Page Object Tool ${name}`);
    return tool;
  };

  /** The part of the Page Object a tool's action belongs to. */
  const targetOf = async (
    tool: Bound,
    item: string | undefined
  ): Promise<Record<string, unknown>> => {
    let target = (await rootOf(tool)) as Record<string, unknown>;
    for (const step of tool.steps) {
      const member = target[step.member];
      const value: unknown =
        step.access === "method"
          ? await (member as () => unknown).call(target)
          : member;
      target = (
        step.collection
          ? await itemWithText(
              value as readonly object[] | Promise<readonly object[]>,
              item ?? "",
              `${tool.name}: ${step.member}`
            )
          : value
      ) as Record<string, unknown>;
    }
    return target;
  };

  const run = async (name: string, input: JsonValue): Promise<unknown> => {
    const tool = toolNamed(name);
    const { item, args } = split(tool, input);
    const target = await targetOf(tool, item);
    const reason = await ruledOut(target, tool.methodName);
    if (reason !== undefined) throw new NotAvailable(tool.name, reason);
    const method = target[tool.methodName] as (...a: unknown[]) => unknown;
    return method.apply(target, positional(tool, args));
  };

  return {
    tools: [...bound.values()],
    run,
    ruledOutNow(name) {
      const tool = toolNamed(name);
      // An item of a collection is picked only at the call: never ruled out here.
      if (tool.collection) return Promise.resolve(undefined);
      return targetOf(tool, undefined).then(
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
        const items = steps.filter((step) => step.collection).length;
        for (const action of component.tools) {
          // A destructured parameter has no name to pass a value under, and
          // an item inside an item is not picked by one text: both left out.
          const parameters = action.parameters.flatMap((parameter) =>
            "name" in parameter ? [parameter] : []
          );
          if (parameters.length !== action.parameters.length || items > 1)
            continue;
          const own = {
            type: "object",
            properties: Object.fromEntries(
              parameters.map((parameter) => [parameter.name, parameter.schema])
            ),
            required: parameters
              .filter((parameter) => !parameter.optional)
              .map((parameter) => parameter.name),
            additionalProperties: false,
          };
          const membersPath = steps.map((step) => step.member).join(".");
          found.push({
            className: component.className,
            parent,
            // The listed class carries its file; a part that names none shares it.
            sourceFile: component.file ?? file,
            rootClass: manifest.className,
            steps,
            methodName: action.methodName,
            parameters,
            collection: items === 1,
            path: membersPath,
            description: `${action.description ?? `Page Object Tool ${action.toolName}.`}${membersPath === "" ? "" : ` (${manifest.className}'s ${membersPath})`}`,
            inputSchema:
              items === 1
                ? {
                    type: "object",
                    properties: {
                      item: {
                        type: "string",
                        minLength: 1,
                        description:
                          "Which item: text it shows that no other item shows, such as its name.",
                      },
                      args: own,
                    },
                    required: ["item", "args"],
                    additionalProperties: false,
                  }
                : own,
          });
        }
        for (const member of component.members) {
          if (member.kind !== "component") continue;
          const child = classes.get(member.componentClassName);
          // A class that holds itself, directly or not, is followed once.
          if (child === undefined || onWay.includes(child.className)) continue;
          walk(
            child,
            [
              ...steps,
              {
                member: member.memberName,
                access: member.access,
                collection: member.collection,
              },
            ],
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

/** A call's input as the item's text, when the tool takes one, and the action's own arguments. */
function split(
  tool: Bound,
  input: JsonValue
): { item: string | undefined; args: Record<string, unknown> } {
  const given = (input ?? {}) as Record<string, unknown>;
  return tool.collection
    ? {
        item: given.item as string,
        args: (given.args ?? {}) as Record<string, unknown>,
      }
    : { item: undefined, args: given };
}

/** Text as a person reads it: runs of white space as one space, no space at the ends. */
const readable = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The one item of a collection that shows `text`: the item whose text is
 * exactly that, or else the one item whose text holds it, read from each
 * item's Page Object Root. No item, or more than one, is an error that names
 * what the items show, so a call never runs on a guess.
 */
export async function itemWithText<Item extends object>(
  items: readonly Item[] | Promise<readonly Item[]>,
  text: string,
  /** What the items are, for the error: `ListPage.entries`. */
  what = "the collection"
): Promise<Item> {
  const listed = await items;
  const wanted = readable(text);
  if (wanted === "") throw new Error(`${what}: name the item by text it shows`);
  const shown = await Promise.all(
    listed.map(async (item) => {
      const root = modelOption(item.constructor, "root");
      if (root === undefined)
        throw new Error(
          `${what}: ${item.constructor.name} has no Page Object Root to read its text from`
        );
      const first = (await Promise.resolve(root(item as never))).first();
      return readable((await first.textContent()) ?? "");
    })
  );
  const exact = listed.filter((_, at) => shown[at] === wanted);
  const holding = listed.filter((_, at) => shown[at]?.includes(wanted));
  const found = exact.length === 1 ? exact : holding;
  if (found.length === 1) return found[0] as Item;
  const seen = shown
    .slice(0, 10)
    .map((line) => JSON.stringify(line.slice(0, 60)))
    .join(", ");
  throw new Error(
    found.length === 0
      ? `${what}: no item shows ${JSON.stringify(wanted)}; the ${listed.length} items show ${seen || "nothing"}`
      : `${what}: ${found.length} items show ${JSON.stringify(wanted)}; give more of the one item's text (the items show ${seen})`
  );
}

/** The arguments in the method's own order, with trailing ones left out staying left out. */
function positional(tool: Bound, args: Record<string, unknown>): unknown[] {
  const values = tool.parameters.map((parameter) => args[parameter.name]);
  while (values.length > 0 && values.at(-1) === undefined) values.pop();
  return values;
}

/** What the action returned, when it is a plain value. */
function returned(result: unknown): string {
  if (result === undefined || result === null || typeof result === "object")
    return "";
  return ` and returned ${JSON.stringify(result)}`;
}
