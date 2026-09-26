import type { Locator } from "@playwright/test";

/** How the Tools lens labels its groups. */
export type ToolGroupLabel = "Page object tools" | "Ref tools" | "Agent tools";

const groupLabels: readonly ToolGroupLabel[] = [
  "Page object tools",
  "Ref tools",
  "Agent tools",
];

/** The Tools lens's tree: the published tools, grouped. */
export class ToolsLens {
  readonly root: Locator;
  /** Says that nothing is published. */
  readonly empty: Locator;
  /** A failed publication's error, in place of the list. */
  readonly error: Locator;

  constructor(navigator: Locator) {
    this.root = navigator;
    this.empty = navigator.getByText("No tools are published.");
    this.error = navigator.getByRole("alert");
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
