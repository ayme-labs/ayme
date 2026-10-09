import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { RefField } from "./RefField";

/**
 * `generate_locator`'s form in a run card: one group per page object class,
 * each with a container and its targets, by group number from 1.
 */
@ayme
export class LocatorGroups {
  /** The list of groups. */
  readonly root: Locator;
  readonly addGroupButton: Locator;

  constructor(card: Locator) {
    this.root = card.getByRole("list", { name: "Locator groups" });
    this.addGroupButton = card.getByRole("button", { name: "Add group" });
  }

  group(number: number): Locator {
    return this.root.getByRole("listitem", {
      name: `Group ${number}`,
      exact: true,
    });
  }

  /** A group's container field. */
  container(number: number): RefField {
    return new RefField(this.group(number), `Container of group ${number}`);
  }

  /** Sets a group's container back to the page. */
  @ayme.action({ description: "Sets a group's container back to the page." })
  async usePage(number: number) {
    await this.group(number)
      .getByRole("button", { name: "Use the page" })
      .click();
  }

  /** A group's targets, in the order they were added. */
  targets(number: number): Locator {
    return this.group(number)
      .getByRole("list", { name: `Targets of group ${number}` })
      .getByRole("listitem");
  }

  /** The refs of a group's targets, in order. */
  @ayme.action({
    description: "Lists the refs of a group's targets, in order.",
  })
  async targetRefs(number: number): Promise<string[]> {
    return Promise.all(
      (await this.targets(number).all()).map(
        async (target) => (await target.getAttribute("aria-label")) ?? ""
      )
    );
  }

  /** The locator the last run gave a target. */
  locator(number: number, ref: string): Locator {
    return this.group(number).getByLabel(`Locator for ${ref}`, {
      exact: true,
    });
  }

  copyButton(number: number, ref: string): Locator {
    return this.group(number).getByRole("button", {
      name: `Copy the locator for ${ref}`,
    });
  }

  /** What a target shows besides its locator: why it has none. */
  target(number: number, ref: string): Locator {
    return this.group(number).getByRole("listitem", { name: ref, exact: true });
  }

  /** Why a group's container failed in the last run. */
  groupError(number: number): Locator {
    return this.group(number).getByRole("alert");
  }

  @ayme.action({ description: "Removes a target from a group." })
  async removeTarget(number: number, ref: string) {
    await this.group(number)
      .getByRole("button", { name: `Remove ${ref}`, exact: true })
      .click();
  }

  @ayme.action({ description: "Removes a group." })
  async removeGroup(number: number) {
    await this.group(number)
      .getByRole("button", { name: `Remove group ${number}` })
      .click();
  }

  /** Starts or stops picking targets on the page for a group. */
  pickButton(number: number): Locator {
    return this.group(number).getByRole("button", { name: "Pick on page" });
  }

  treeButton(number: number): Locator {
    return this.group(number).getByRole("button", { name: "Add from tree" });
  }

  /** The tree that adds a group's targets, while it's open. */
  tree(number: number): Locator {
    return this.group(number).getByRole("tree", {
      name: `Add targets to group ${number}`,
    });
  }

  /** Adds targets from the tree, or removes ones it has, by ref. */
  @ayme.action({
    description:
      "Adds targets from a group's tree, or removes ones it has, by ref.",
  })
  async toggleFromTree(number: number, ...refs: string[]) {
    if (
      (await this.treeButton(number).getAttribute("aria-expanded")) !== "true"
    )
      await this.treeButton(number).click();
    for (const ref of refs)
      await this.tree(number)
        .getByRole("treeitem")
        .filter({ hasText: new RegExp(`^${ref}(?!\\d)`) })
        .click();
  }
}
