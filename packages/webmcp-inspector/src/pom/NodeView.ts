import type { Locator } from "@playwright/test";

import { RunCard } from "./RunCard";
import { WhatTheModelSees } from "./WhatTheModelSees";

/** A structure node's detail: what it is, who owns it, and its Ref tools. */
export class NodeView {
  readonly root: Locator;
  /** The node as the page state lists it, e.g. `e3 button "Add item"`. */
  readonly title: Locator;
  /**
   * The Page Object members that locate it, the row's tag first. Each opens
   * the Page Object that owns it.
   */
  readonly memberLinks: Locator;
  /** The Ref tools that run on it. */
  readonly tools: Locator;
  /** Its page-state line and its Ref tools' schemas, as an agent gets them. */
  readonly modelSees: WhatTheModelSees;

  constructor(detail: Locator) {
    this.root = detail.getByRole("article", { name: "Structure node" });
    this.title = this.root.getByRole("heading", { level: 2 });
    this.memberLinks = this.root
      .getByRole("group", { name: "Page object members" })
      .getByRole("button");
    this.tools = this.root.getByRole("region", { name: "Tools" });
    this.modelSees = new WhatTheModelSees(this.root);
  }

  /** The run slot of one Ref tool the node offers, by the tool's name. */
  tool(name: string): Locator {
    return this.tools.getByRole("group", { name, exact: true });
  }

  /** The run card of one Ref tool the node offers, by the tool's name. */
  runCard(name: string): RunCard {
    return new RunCard(this.tool(name).getByRole("form"));
  }

  /** Opens the Page Object that owns one of its members. */
  async openOwnerOf(member: string) {
    await this.memberLinks.filter({ hasText: member }).first().click();
  }
}
