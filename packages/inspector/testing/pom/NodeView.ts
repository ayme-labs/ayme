import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";

import { PanelPart } from "./PanelPart";
import { RunCard } from "./RunCard";
import { WhatTheModelSees } from "./WhatTheModelSees";

/** A structure node's detail: what it is, who owns it, and its single-element tools. */
export class NodeView extends PanelPart {
  /** Its page-state line and its single-element tools' schemas, as an agent gets them. */
  @ayme.child
  readonly modelSees: WhatTheModelSees;

  constructor(detail: Locator) {
    super(detail.getByRole("article", { name: "Structure node" }));
    this.modelSees = new WhatTheModelSees(this.root);
  }

  /** The node as the page state lists it, e.g. `e3 button "Add item"`. */
  @ayme.child
  get title(): Locator {
    return this.root.getByRole("heading", { level: 2 });
  }

  /**
   * The Page Object members that locate it, the row's tag first. Each opens
   * the Page Object that owns it.
   */
  @ayme.collection
  get memberLinks(): Locator {
    return this.root
      .getByRole("group", { name: "Page object members" })
      .getByRole("button");
  }

  /** The single-element tools that run on it. */
  @ayme.child
  get tools(): Locator {
    return this.root.getByRole("region", { name: "Tools" });
  }

  /** The run slot of one single-element tool the node offers, by the tool's name. */
  tool(name: string): Locator {
    return this.tools.getByRole("group", { name, exact: true });
  }

  /** The run card of one single-element tool the node offers, by the tool's name. */
  runCard(name: string): RunCard {
    return new RunCard(this.tool(name).getByRole("form"));
  }

  /** Opens the Page Object that owns one of its members. */
  @ayme.action({
    description: "Opens the Page Object that owns one of the node's members.",
  })
  async openOwnerOf(member: string) {
    await this.memberLinks.filter({ hasText: member }).first().click();
  }
}
