// Pilot page objects in the repo's conventions (a `root` locator member anchors the instance;
// controls are named locators; decorators are runtime no-ops, so they are left out here), plus
// hand-written manifests in the shape derivePomManifests emits (packages/ayme/src/contracts.ts:72-78).
import type { Locator, Page } from "playwright";
import type { PomManifest } from "./probe.ts";

export class CounterPage {
  readonly root: Locator;
  readonly incrementButton: Locator;
  constructor(page: Page) {
    this.root = page.getByRole("region", { name: "Counter" });
    this.incrementButton = this.root.getByRole("button", { name: "Increment", exact: true });
  }
  async increment() { await this.incrementButton.click(); }
}

export class ProjectsPage {
  readonly root: Locator;
  readonly newProjectButton: Locator;
  constructor(page: Page) {
    this.root = page.getByRole("region", { name: "Projects" });
    this.newProjectButton = this.root.getByRole("button", { name: "New project" });
  }
  async createProject(name: string) { void name; await this.newProjectButton.click(); }
}

export class ArchiveDialog {
  readonly root: Locator;
  readonly confirmButton: Locator;
  constructor(page: Page) {
    this.root = page.getByRole("dialog", { name: "Archive item" });
    this.confirmButton = this.root.getByRole("button", { name: "Confirm" });
  }
  async confirm() { await this.confirmButton.click(); }
}

export class Sidebar {
  readonly root: Locator;
  readonly closeButton: Locator;
  constructor(page: Page) {
    this.root = page.getByRole("complementary", { name: "Sidebar" });
    this.closeButton = this.root.getByRole("button", { name: "Close" });
  }
  async close() { await this.closeButton.click(); }
}

/** Rootless, like apps/example-react/playwright/pom/CounterPage.ts today. */
export class StatusPage {
  readonly status: Locator;
  constructor(page: Page) { this.status = page.getByRole("status", { name: "Publication" }); }
  async readStatus() { return this.status.textContent(); }
}

const emptyInput = { type: "object", properties: {}, required: [], additionalProperties: false } as const;
const tool = (className: string, methodName: string) => ({
  methodName, toolName: `${className}.${methodName}`, description: `Run ${methodName}.`,
  inputSchema: emptyInput, parameters: [],
});
const locator = (memberName: string) => ({ memberName, kind: "locator", access: "field" }) as const;

export const manifests: Record<string, PomManifest> = {
  CounterPage: { className: "CounterPage", members: [locator("root"), locator("incrementButton")], components: [], tools: [tool("CounterPage", "increment")] },
  ProjectsPage: { className: "ProjectsPage", members: [locator("root"), locator("newProjectButton")], components: [], tools: [tool("ProjectsPage", "createProject")] },
  ArchiveDialog: { className: "ArchiveDialog", members: [locator("root"), locator("confirmButton")], components: [], tools: [tool("ArchiveDialog", "confirm")] },
  Sidebar: { className: "Sidebar", members: [locator("root"), locator("closeButton")], components: [], tools: [tool("Sidebar", "close")] },
  StatusPage: { className: "StatusPage", members: [locator("status")], components: [], tools: [tool("StatusPage", "readStatus")] },
};
export const classes = { CounterPage, ProjectsPage, ArchiveDialog, Sidebar, StatusPage };
