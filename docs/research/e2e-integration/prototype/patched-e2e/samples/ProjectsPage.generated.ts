import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme({
  description:
    "The new-project form that opens after Add project is clicked: a project name field and a Create button.",
})
export class NewProjectForm {
  readonly root: Locator;
  readonly projectNameField: Locator;
  readonly createButton: Locator;
  constructor(projectsSection: Locator) {
    // The form only exists while the "Add project" form is open.
    this.root = projectsSection.locator("form");
    this.projectNameField = this.root.getByRole("textbox", {
      name: "Project name",
      exact: true,
    });
    this.createButton = this.root.getByRole("button", {
      name: "Create",
      exact: true,
    });
  }

  @ayme.action({
    description:
      "Type the project name into the open new-project form and submit it with Create.",
  })
  async submit(name: string) {
    await this.projectNameField.fill(name);
    await this.createButton.click();
  }
}

@ayme({
  description:
    "The Projects screen: open the new-project form, create a project by name, and see it appear in the project list.",
})
export class ProjectsPage {
  readonly projectsSection: Locator;
  readonly addProjectButton: Locator;
  readonly projectItems: Locator;
  readonly newProjectForm: NewProjectForm;
  constructor(page: Page) {
    this.projectsSection = page.getByRole("region", {
      name: "Projects",
      exact: true,
    });
    this.addProjectButton = this.projectsSection.getByRole("button", {
      name: "Add project",
      exact: true,
    });
    this.projectItems = this.projectsSection.getByRole("listitem");
    this.newProjectForm = new NewProjectForm(this.projectsSection);
  }

  @ayme.action({
    description:
      "Create a project with the given name: open the Add project form, enter the name, submit it, and wait until the project appears in the list.",
  })
  async createProject(name: string) {
    await this.addProjectButton.click();
    await this.newProjectForm.projectNameField.fill(name);
    await this.newProjectForm.createButton.click();
    await this.projectItems.filter({ hasText: name }).waitFor();
  }
}
