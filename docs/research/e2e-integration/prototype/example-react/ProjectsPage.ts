import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme
export class ProjectsPage {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole("region", { name: "Projects" });
  }

  @ayme.action({ description: "Create a project with the given name." })
  async createProject(name: string) {
    await this.root.getByRole("button", { name: "New project" }).click();
    await this.root.getByRole("textbox", { name: "Project name" }).fill(name);
    await this.root.getByRole("button", { name: "Create" }).click();
  }
}
