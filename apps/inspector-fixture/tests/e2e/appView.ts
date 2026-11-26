import type { JsonValue } from "e2e";

import {
  legendCounts,
  type LegendCounts,
  type LiveTool,
  type LoggedRun,
} from "../appView";
import type { Tab } from "./tab";

// The e2e counterpart of `../appView.ts`.

export type { LegendCounts, LiveTool, LoggedRun };

/**
 * The fixture page's own runtime, read and run as the app does through
 * `ayme.tools`: its live tool list, and the Browser Tools and snapshot that
 * no agent's ayme MCP server lists. A run through here is the app's. The e2e
 * tests take their expected values from here or from the agent, never from
 * the panel. It reads the fixture page's tab, which it brings to the front.
 */
export class AppView {
  constructor(private readonly page: Tab) {}

  /** Every live tool, in the runtime's order. */
  async tools(): Promise<LiveTool[]> {
    await this.page.front();
    // e2e's `evaluate` hands back JSON values only, so the page sends JSON.
    return JSON.parse(
      await this.page.browser.evaluate(() =>
        JSON.stringify(
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
        )
      )
    ) as LiveTool[];
  }

  /** Runs a tool as the app, and returns its result. */
  async run(
    name: string,
    input: { [key: string]: JsonValue } = {}
  ): Promise<unknown> {
    await this.page.front();
    return JSON.parse(
      await this.page.browser.evaluate(
        async ({ name, input }) =>
          JSON.stringify(
            (await window.fixtureAyme!.tools.run(name, input as never)) ?? null
          ),
        { name, input }
      )
    ) as unknown;
  }

  /** The error the app gets when the runtime refuses to run a tool, as text. */
  async refusal(
    name: string,
    input: { [key: string]: JsonValue } = {}
  ): Promise<string> {
    await this.page.front();
    const refusal = await this.page.browser.evaluate(
      ({ name, input }) =>
        window.fixtureAyme!.tools.run(name, input as never).then(
          () => null,
          (error: Error) => String(error)
        ),
      { name, input }
    );
    if (refusal === null)
      throw new Error(`${name} ran; it was expected to be refused.`);
    return refusal;
  }

  /** The page's top-level Runs, oldest first, as its Run log has them. */
  async runs(): Promise<LoggedRun[]> {
    await this.page.front();
    return JSON.parse(
      await this.page.browser.evaluate(() =>
        JSON.stringify(
          window
            .fixtureAyme!.runs.list()
            .filter((run) => run.parent === undefined)
            .map(({ tool, status, result, error }) => ({
              tool,
              status,
              result,
              error,
            }))
        )
      )
    ) as LoggedRun[];
  }

  /** The navigator legend's counts, from `page_objects` and `snapshot`. */
  async legendCounts(): Promise<LegendCounts> {
    return legendCounts(
      (await this.run("page_objects")) as string,
      await this.pomDefinitions(),
      await this.structure()
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
