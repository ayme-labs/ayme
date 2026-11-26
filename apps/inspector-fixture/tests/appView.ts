import type { Page } from "@playwright/test";

/** A tool of the page's runtime, as its live tool list gives it. */
export type LiveTool = {
  name: string;
  /** The text an agent reads, if the tool says anything beyond its name. */
  agentDescription?: string;
  inputSchema: unknown;
  destructive?: true;
  /** Its group in the Tools lens, such as `pageObject` or `peek`. */
  group: string;
  /** Whether a call can run it now; when not, `reason` says why. */
  available: boolean;
  reason?: string;
};

/** A Run as the page's Run log has it. */
export type LoggedRun = {
  tool: string;
  input?: unknown;
  result?: unknown;
};

/** The navigator legend's three counts, as the page's runtime gives them. */
export type LegendCounts = { live: number; notOnPage: number; refs: number };

/** One line of an indented text, by its indent. */
const indented = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => ({
      indent: line.length - line.trimStart().length,
      text: line.trim().replace(/^- /, ""),
    }));

/**
 * The legend's counts from what the runtime gives an agent: the Page
 * Objects `page_objects` lists are live; a single Page Object child that a
 * live one's definition declares (`name: Class`) and `page_objects` leaves
 * out is not on the page; the refs are the nodes of `snapshot`'s structure,
 * each line's first token after its dash, whatever its form (`e5`, `s_1`),
 * skipping text lines and property lines.
 */
export function legendCounts(
  pageObjects: string,
  definitions: string,
  structure: string
): LegendCounts {
  // The single Page Object children each class declares, from its block.
  const declared = new Map<string, string[]>();
  let current: string[] = [];
  for (const { indent, text } of indented(definitions)) {
    // A declaration may end in its authored description, `// ...`.
    const declaration = text.replace(/\s*\/\/.*$/, "");
    if (indent === 0) declared.set(declaration, (current = []));
    else if (/^\w+: [A-Z]\w*$/.test(declaration))
      current.push(declaration.split(":")[0]!);
  }
  const lines = indented(pageObjects);
  let live = 0;
  let notOnPage = 0;
  lines.forEach(({ indent, text }, at) => {
    // A Page Object's line names its class: alone, as a child's value, or
    // as a collection's item, with its id when it has a root.
    const className = /^(?:\w+: )?([A-Z]\w*)(?: po\d+)?$/.exec(text)?.[1];
    if (!className || !declared.has(className)) return;
    live += 1;
    const end = lines.findIndex((line, i) => i > at && line.indent <= indent);
    const members = lines
      .slice(at + 1, end === -1 ? undefined : end)
      .map((line) => line.text.split(":")[0]);
    notOnPage += declared
      .get(className)!
      .filter((child) => !members.includes(child)).length;
  });
  return {
    live,
    notOnPage,
    refs: new Set(
      structure
        .split("\n")
        .map((line) => /^\s*- ([^\s:]+)/.exec(line)?.[1])
        // A text line has `text:`, and a node's property lines, such as a
        // link's `- /url: /docs`, start with a slash.
        .filter(
          (token) =>
            token !== undefined && token !== "text" && !token.startsWith("/")
        )
    ).size,
  };
}

/**
 * The fixture page's own runtime, read and run as the app does through
 * `ayme.tools`: its live tool list, and the Browser Tools and snapshot that
 * no agent's ayme MCP server lists. A run through here is the app's. The e2e
 * tests take their expected values from here or from the agent, never from
 * the panel.
 */
export class AppView {
  constructor(private readonly page: Page) {}

  /** Every live tool, in the runtime's order. */
  tools(): Promise<LiveTool[]> {
    return this.page.evaluate(() =>
      window
        .fixtureAyme!.tools.list()
        .map(
          ({
            name,
            agentDescription,
            inputSchema,
            destructive,
            group,
            available,
            reason,
          }) => ({
            name,
            agentDescription,
            inputSchema,
            destructive,
            group,
            available,
            reason,
          })
        )
    );
  }

  /** The error the app gets when the runtime refuses to run a tool, as text. */
  refusal(name: string, input: object = {}): Promise<string> {
    return this.page.evaluate(
      ([name, input]) =>
        window.fixtureAyme!.tools.run(name, input as never).then(
          () => {
            throw new Error(`${name} ran; it was expected to be refused.`);
          },
          (error: Error) => String(error)
        ),
      [name, input] as const
    );
  }

  /** The page's top-level Runs, oldest first, as its Run log has them. */
  runs(): Promise<LoggedRun[]> {
    return this.page.evaluate(() =>
      window
        .fixtureAyme!.runs.list()
        .filter((run) => run.parent === undefined)
        .map(({ tool, input, result }) => ({ tool, input, result }))
    );
  }

  /** The navigator legend's counts, from `page_objects` and `snapshot`. */
  async legendCounts(): Promise<LegendCounts> {
    // One snapshot, so its definitions and structure describe one moment.
    const { pomDefinitions, structure } = (await this.run("snapshot", {
      names: [],
    })) as { pomDefinitions: string; structure: string };
    return legendCounts(
      (await this.run("page_objects")) as string,
      pomDefinitions,
      structure
    );
  }

  /** Runs a tool as the app, and returns its result. */
  run(name: string, input: object = {}): Promise<unknown> {
    return this.page.evaluate(
      ([name, input]) => window.fixtureAyme!.tools.run(name, input as never),
      [name, input] as const
    );
  }

  /** The page state snapshot gives. */
  async structure(): Promise<string> {
    return ((await this.run("snapshot")) as { structure: string }).structure;
  }

  /**
   * The ref snapshot gives the node on this structure line, such as
   * `button "Add item"`.
   */
  async ref(line: string): Promise<string> {
    const structure = await this.structure();
    const ref = structure.match(new RegExp(`(e\\d+) ${line}`))?.[1];
    if (!ref) throw new Error(`No ${line} in:\n${structure}`);
    return ref;
  }

  /**
   * The Page Object id snapshot gives the Page Object Root of this class,
   * such as `Navigator`, whether the root is marked with the class alone or
   * lists it among several.
   */
  async id(className: string): Promise<string> {
    const structure = await this.structure();
    const id =
      structure.match(new RegExp(`e\\d+ ${className} (po\\d+)`))?.[1] ??
      // On a root of several classes, `id` lists the ids in the order `pom`
      // lists the classes.
      [...structure.matchAll(/\/pom: (\[[^\]]*\])\s+- \/id: (\[[^\]]*\])/g)]
        .map(([, classes, ids]) => {
          const at = (JSON.parse(classes!) as string[]).indexOf(className);
          return at >= 0 ? (JSON.parse(ids!) as string[])[at] : undefined;
        })
        .find((found) => found !== undefined);
    if (!id) throw new Error(`No ${className} in:\n${structure}`);
    return id;
  }

  /** The Page Object definitions snapshot returns for these models. */
  async pomDefinitions(...names: string[]): Promise<string> {
    const { pomDefinitions } = (await this.run("snapshot", { names })) as {
      pomDefinitions: string;
    };
    return pomDefinitions;
  }
}
