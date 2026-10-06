import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

/** How the Tools lens labels its groups. */
export type ToolGroupLabel =
  | "Page object tools"
  | "Custom tools"
  | "Browser tools"
  | "Peek tools"
  | "Agent tools";

/** The sections of the Peek tools group: the page's and the App Processes'. */
export type PeekSideLabel = "Browser" | "Node";

const groupLabels: readonly ToolGroupLabel[] = [
  "Page object tools",
  "Custom tools",
  "Browser tools",
  "Peek tools",
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

  /** A tool's row in its group's list. */
  row(name: string): Locator {
    return this.root.getByRole("listitem").filter({
      has: this.root.page().getByRole("button", { name, exact: true }),
    });
  }

  /** Whether a separator sets a tool's row apart from the rows above it. */
  async separatorBefore(name: string): Promise<boolean> {
    return (await this.row(name).locator("[data-peek-separator]").count()) > 0;
  }

  /** The Peek tools' names, by the side each row's badge shows. */
  async peekSections(): Promise<Partial<Record<PeekSideLabel, string[]>>> {
    // One read of every row, so a row that goes meanwhile is never waited for.
    const rows = await this.group("Peek tools")
      .getByRole("listitem")
      .evaluateAll((items) =>
        items.map((item) => ({
          name: item.querySelector("button")?.textContent ?? "",
          side: item.querySelector("[data-peek-side]")?.textContent ?? "",
        }))
      );
    const sections: Partial<Record<PeekSideLabel, string[]>> = {};
    for (const { name, side } of rows)
      (sections[side as PeekSideLabel] ??= []).push(name);
    return sections;
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
