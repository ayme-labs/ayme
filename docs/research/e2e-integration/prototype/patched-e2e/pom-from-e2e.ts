/**
 * Page objects from the replay cache, deterministically.
 *
 *   node pom-from-e2e.ts --plan <cache-dir> [--tests <dir>]
 *     Prints a JSON plan: one class per start path, one method per distinct
 *     recorded action list (tests that share a step collapse into one), the
 *     member locators those actions use with proposed names, child page
 *     object candidates for the containers actions were recorded `within`,
 *     method parameters from `{{param:/x}}` slots, and a final wait from the
 *     recorded end state. What the cache cannot decide is listed as
 *     `judgment`, for whoever writes the page object.
 *
 *   node pom-from-e2e.ts --repair <repairs-dir> <page-object-file>
 *     Prints a proposed patch to a hand-written page object from the repair
 *     proposals a failed replay left: which locator in the file the passing
 *     fallback no longer matches, and what it matched instead.
 *
 * No model, no browser, no app access: only cache entries and test sources.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface Descriptor {
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  placeholder?: string;
  within?: string;
  position?: { index: number; of: number };
}
interface Action {
  name: string;
  summary: string;
  target?: Descriptor;
  value?: string;
  key?: string;
  url?: string;
  tool?: string;
}
interface Trace {
  actions: Action[];
  recordedFor?: { testId: string; instructionDigest: string };
  startPath?: string;
  endPath?: string;
  endAnchors?: Descriptor[];
}

const PLACEHOLDER = /\{\{param:\/([^}|]+)(?:\|[a-z]+)?\}\}/g;

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function words(text: string): string[] {
  return text
    .replace(PLACEHOLDER, " $1 ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function camel(parts: readonly string[]): string {
  return parts
    .map((part, index) =>
      index === 0
        ? part.toLowerCase()
        : part[0]!.toUpperCase() + part.slice(1).toLowerCase()
    )
    .join("");
}

/** The suffix a member name gets for its role, so `button "New project"` reads `newProjectButton`. */
const ROLE_SUFFIX: Record<string, string> = {
  button: "Button",
  link: "Link",
  textbox: "Field",
  searchbox: "SearchField",
  combobox: "Select",
  checkbox: "Checkbox",
  radio: "Radio",
  switch: "Switch",
  tab: "Tab",
  listitem: "Item",
  heading: "Heading",
  region: "Section",
  dialog: "Dialog",
};

/**
 * Roles whose accessible name never comes from their content in ARIA, so
 * Playwright's `getByRole(role, { name })` finds nothing although the e2e
 * tree names the node by its text. Those are located by role and text.
 */
const NAME_NOT_FROM_CONTENT = new Set([
  "listitem",
  "list",
  "region",
  "group",
  "status",
  "table",
  "row",
  "paragraph",
]);

/** A Playwright locator expression for a recorded descriptor; `{{param}}` slots become parameters. */
function locatorOf(target: Descriptor): string {
  const literal = (text: string) =>
    PLACEHOLDER.test(text)
      ? text.replace(PLACEHOLDER, "$1").trim()
      : JSON.stringify(text);
  PLACEHOLDER.lastIndex = 0;
  if (target.testId !== undefined)
    return `getByTestId(${literal(target.testId)})`;
  if (target.role !== undefined && target.name !== undefined) {
    const name = literal(target.name);
    PLACEHOLDER.lastIndex = 0;
    if (NAME_NOT_FROM_CONTENT.has(target.role))
      return `getByRole(${JSON.stringify(target.role)}).filter({ hasText: ${name} })`;
    return `getByRole(${JSON.stringify(target.role)}, { name: ${name}, exact: true })`;
  }
  if (target.placeholder !== undefined)
    return `getByPlaceholder(${literal(target.placeholder)})`;
  if (target.text !== undefined)
    return `getByText(${literal(target.text)}, { exact: true })`;
  return `getByRole(${JSON.stringify(target.role ?? "generic")})`;
}

function memberName(target: Descriptor): string {
  const label =
    target.name ??
    target.text ??
    target.placeholder ??
    target.testId ??
    target.role ??
    "node";
  const base = camel(words(label));
  const suffix = ROLE_SUFFIX[target.role ?? ""] ?? "";
  return base.toLowerCase().endsWith(suffix.toLowerCase())
    ? base
    : `${base}${suffix}`;
}

function paramsOf(actions: readonly Action[]): string[] {
  const names = new Set<string>();
  for (const action of actions)
    for (const match of JSON.stringify(action).matchAll(PLACEHOLDER))
      names.add(match[1]!);
  return [...names];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The recorded actions with prose dropped: two tests that did the same thing hash the same. */
function actionsHash(actions: readonly Action[]): string {
  return sha256(
    JSON.stringify(actions.map(({ summary: _summary, ...rest }) => rest))
  ).slice(0, 12);
}

/**
 * The instruction a recording was made for. The cache keeps only its digest
 * (`recordedFor.instructionDigest`), so it is recovered from the test file
 * the test id names: every `agent.act('…')` string there, digested the way
 * e2e digests it, until one matches.
 */
function instructionFor(
  testId: string,
  digest: string,
  testsRoot: string
): string | undefined {
  const file = path.join(testsRoot, testId.split("::")[0]!);
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  for (const match of source.matchAll(
    /agent\.act\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g
  )) {
    const instruction = match[2]!;
    if (
      sha256(instruction.replace(/\r\n?/g, "\n").normalize("NFC").trim()) ===
      digest
    )
      return instruction;
  }
  return undefined;
}

/** A method name from an instruction: the words before its first parameter, articles dropped. */
function methodName(instruction: string | undefined, fallback: string): string {
  if (instruction === undefined) return fallback;
  const head = instruction
    .split(/\{/)[0]!
    .replace(/\b(named|called|with|as|to)\s*$/i, "");
  return (
    camel(words(head).filter((word) => !/^(a|an|the)$/i.test(word))) || fallback
  );
}

function className(startPath: string | undefined): string {
  const segment = (startPath ?? "/")
    .split(/[?#]/)[0]!
    .split("/")
    .filter(Boolean)
    .at(-1);
  // A root path names no page; the method's object is the best guess, and a judgment.
  return segment === undefined
    ? ""
    : `${camel(words(segment)).replace(/^./, (c) => c.toUpperCase())}Page`;
}

function plan(cacheDir: string, testsRoot: string) {
  const traces = readdirSync(cacheDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      file,
      trace: readJson<{ payload: Trace }>(path.join(cacheDir, file)).payload,
    }));
  const judgment: string[] = [];
  const groups = new Map<
    string,
    { trace: Trace; tests: string[]; files: string[] }
  >();
  for (const { file, trace } of traces) {
    const key = `${trace.startPath ?? ""}|${actionsHash(trace.actions)}`;
    const group = groups.get(key) ?? { trace, tests: [], files: [] };
    group.tests.push(trace.recordedFor?.testId ?? "?");
    group.files.push(file);
    groups.set(key, group);
  }
  const classes = new Map<
    string,
    {
      startPath: string;
      members: Map<string, object>;
      children: Map<string, object>;
      methods: object[];
    }
  >();
  for (const [key, { trace, tests, files }] of groups) {
    const instruction =
      trace.recordedFor === undefined
        ? undefined
        : instructionFor(
            trace.recordedFor.testId,
            trace.recordedFor.instructionDigest,
            testsRoot
          );
    if (instruction === undefined)
      judgment.push(
        `no instruction found for ${tests.join(", ")}: name the method by hand`
      );
    const method = methodName(instruction, `step${actionsHash(trace.actions)}`);
    let cls = className(trace.startPath);
    if (cls === "") {
      const object = words(instruction?.split("{")[0] ?? "")
        .filter(
          (w) =>
            !/^(a|an|the|named|called|create|add|open|delete|edit)$/i.test(w)
        )
        .at(-1);
      cls =
        object === undefined
          ? "HomePage"
          : `${object[0]!.toUpperCase()}${object.slice(1)}sPage`;
      judgment.push(
        `start path ${JSON.stringify(trace.startPath ?? "/")} names no page: class "${cls}" is guessed from the instruction's object`
      );
    }
    const entry = classes.get(cls) ?? {
      startPath: trace.startPath ?? "/",
      members: new Map(),
      children: new Map(),
      methods: [],
    };
    classes.set(cls, entry);
    const steps: object[] = [];
    for (const action of trace.actions) {
      if (action.target === undefined) {
        steps.push({
          action: action.name,
          ...(action.url === undefined ? {} : { url: action.url }),
          ...(action.key === undefined ? {} : { key: action.key }),
        });
        continue;
      }
      const name = memberName(action.target);
      const { within, ...own } = action.target;
      const member = {
        name,
        role: own.role,
        accessibleName: own.name,
        locator: locatorOf(own),
      };
      let owner = "this";
      if (within !== undefined && within !== own.name) {
        const childName = `${camel(words(within))}Container`;
        const child = (entry.children.get(childName) as
          { members: Map<string, object> } | undefined) ?? {
          name: childName,
          containerKey: within,
          root: null,
          members: new Map<string, object>(),
        };
        child.members.set(name, member);
        entry.children.set(childName, child);
        owner = `this.${childName}`;
      } else {
        entry.members.set(name, member);
      }
      const verb =
        {
          tap: "click",
          type: "fill",
          select: "selectOption",
          check: "setChecked",
          press: "press",
          hover: "hover",
        }[action.name] ?? action.name;
      const arg = action.value ?? action.key;
      const literal =
        arg === undefined
          ? ""
          : PLACEHOLDER.test(arg)
            ? arg.replace(PLACEHOLDER, "$1")
            : JSON.stringify(arg);
      PLACEHOLDER.lastIndex = 0;
      steps.push({
        call: `${owner}.${name}.${verb}(${literal})`,
        recorded: action.summary,
      });
    }
    // The end state: an anchor that spells a parameter is the step's own
    // outcome; one that does not may be unrelated (a status that changed meanwhile).
    const anchors = trace.endAnchors ?? [];
    const outcome =
      anchors.find((anchor) => PLACEHOLDER.test(JSON.stringify(anchor))) ??
      anchors[0];
    PLACEHOLDER.lastIndex = 0;
    if (anchors.length > 1) {
      judgment.push(
        `${method}: ${anchors.length} end anchors were recorded; the wait uses ${JSON.stringify(outcome)} (it spells a parameter), the rest look incidental: ${JSON.stringify(anchors.filter((a) => a !== outcome))}`
      );
    }
    (entry.methods as object[]).push({
      name: method,
      instruction: instruction ?? null,
      parameters: paramsOf(trace.actions).map((name) => ({
        name,
        type: "string",
      })),
      steps,
      waitFor:
        outcome === undefined
          ? null
          : `this.page.${locatorOf(outcome)}.waitFor()`,
      endPath: trace.endPath ?? null,
      sharedBy: tests,
      actionsHash: key.split("|")[1],
      entries: files,
    });
  }
  for (const [cls, entry] of classes) {
    for (const child of entry.children.values() as Iterable<{
      name: string;
      containerKey: string;
    }>) {
      judgment.push(
        `${cls}.${child.name}: the recording names this container only by its first text (${JSON.stringify(child.containerKey)}), not by its role or label; its root locator and its name need the app`
      );
    }
  }
  return {
    source: { cacheDir, entries: traces.length, distinctFlows: groups.size },
    classes: [...classes].map(([name, entry]) => ({
      name,
      startPath: entry.startPath,
      members: [...entry.members.values()],
      children: [...entry.children.values()].map((child) => ({
        ...(child as object),
        members: [
          ...(child as { members: Map<string, object> }).members.values(),
        ],
      })),
      methods: entry.methods,
    })),
    judgment,
    findings: [
      "recordedFor keeps only instructionDigest: the instruction text was recovered from the test file by digesting every agent.act string in it. Storing the instruction text (redacted) in recordedFor would make the cache self-describing.",
    ],
  };
}

/** Locator calls in a page object source, by role and name: `getByRole("button", { name: "New project" })`. */
function sourceLocators(
  source: string
): { role: string; name: string; text: string }[] {
  return [
    ...source.matchAll(
      /getByRole\(\s*["'](\w+)["']\s*,\s*\{\s*name:\s*["']([^"']+)["']/g
    ),
  ].map((match) => ({
    role: match[1]!,
    name: match[2]!,
    text: match[0],
  }));
}

function repair(repairsDir: string, pageObjectFile: string) {
  const source = readFileSync(pageObjectFile, "utf8");
  const locators = sourceLocators(source);
  const proposals = readdirSync(repairsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) =>
      readJson<{ tool: string; error: string; fallback: Action[] }>(
        path.join(repairsDir, file)
      )
    );
  const changes = new Map<
    string,
    {
      from: string;
      to: string;
      role: string;
      votes: number;
      error: string;
      tool: string;
    }
  >();
  for (const proposal of proposals) {
    const targets = proposal.fallback.flatMap((action) =>
      action.target?.role === undefined || action.target.name === undefined
        ? []
        : [action.target]
    );
    const matched = new Set(
      locators
        .filter((loc) =>
          targets.some((t) => t.role === loc.role && t.name === loc.name)
        )
        .map((loc) => loc.text)
    );
    // A locator the passing flow never matched, beside a control of the same
    // role the passing flow used and the page object does not know: renamed.
    for (const stale of locators.filter((loc) => !matched.has(loc.text))) {
      const replacement = targets.find(
        (t) =>
          t.role === stale.role &&
          !locators.some((loc) => loc.role === t.role && loc.name === t.name)
      );
      if (replacement === undefined) continue;
      const key = `${stale.text}=>${replacement.name}`;
      const change = changes.get(key) ?? {
        tool: proposal.tool,
        role: stale.role,
        from: stale.name,
        to: replacement.name!,
        votes: 0,
        error: proposal.error,
      };
      change.votes += 1;
      changes.set(key, change);
    }
  }
  return {
    pageObject: pageObjectFile,
    proposals: proposals.length,
    changes: [...changes.values()].map((change) => ({
      ...change,
      patch: `- getByRole("${change.role}", { name: "${change.from}" })\n+ getByRole("${change.role}", { name: "${change.to}" })`,
    })),
  };
}

const [mode, first, second] = process.argv.slice(2);
if (mode === "--plan" && first !== undefined) {
  const testsIndex = process.argv.indexOf("--tests");
  console.log(
    JSON.stringify(
      plan(
        first,
        testsIndex === -1 ? process.cwd() : process.argv[testsIndex + 1]!
      ),
      null,
      2
    )
  );
} else if (mode === "--repair" && first !== undefined && second !== undefined) {
  console.log(JSON.stringify(repair(first, second), null, 2));
} else {
  console.error(
    "usage: pom-from-e2e.ts --plan <cache-dir> [--tests <dir>] | --repair <repairs-dir> <page-object-file>"
  );
  process.exit(2);
}
