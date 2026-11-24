import type { Page } from "@playwright/test";

/** A tool of the page's runtime, as its live tool list gives it. */
export type LiveTool = {
  name: string;
  /** The text an agent reads, if the tool says anything beyond its name. */
  agentDescription?: string;
  inputSchema: unknown;
  destructive?: true;
};

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
        .map(({ name, agentDescription, inputSchema, destructive }) => ({
          name,
          agentDescription,
          inputSchema,
          destructive,
        }))
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
