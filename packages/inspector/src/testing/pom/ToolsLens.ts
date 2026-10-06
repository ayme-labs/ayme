import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/** How the Tools lens labels its groups. */
export type ToolGroupLabel =
  "Page object tools" | "Custom tools" | "Browser tools" | "Agent tools";

const groupLabels: readonly ToolGroupLabel[] = [
  "Page object tools",
  "Custom tools",
  "Browser tools",
  "Agent tools",
];

/** The Tools lens's tree: the live tools, grouped. */
@ayme
export class ToolsLens {
  readonly root: Locator;

  constructor(navigator: Locator) {
    this.root = navigator;
  }

  /** One group's list. */
  group(label: ToolGroupLabel): Locator {
    return this.root.getByRole("list", { name: label, exact: true });
  }

  /** A tool's entry, by name. Pressing it opens the tool's page. */
  tool(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }

  /** The listed tools' names, by group, for the groups that list any. */
  async listed(): Promise<Partial<Record<ToolGroupLabel, string[]>>> {
    const listed: Partial<Record<ToolGroupLabel, string[]>> = {};
    for (const label of groupLabels) {
      const names = await this.group(label)
        .getByRole("button")
        .allTextContents();
      if (names.length > 0) listed[label] = names;
    }
    return listed;
  }
}
