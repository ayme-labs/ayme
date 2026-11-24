import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
import { AppPage } from "./AppPage";
import { SurveyEditorPage } from "./SurveyEditorPage";

@ayme({
  description: "Where an organization without surveys creates its first one.",
})
export class SurveyNavigationPage extends AppPage {
  readonly path = "/organizations/:organizationId/workspaces/new/survey";

  @ayme.child
  readonly startFromScratchButton: Locator;

  constructor(page: Page) {
    super(page);
    // The option's accessible name runs on into its description, "Create your own survey questions".
    this.startFromScratchButton = page.getByRole("button", {
      name: /^Start from scratch\b/,
    });
  }

  @ayme.action({ description: "Creates an empty survey." })
  async startFromScratch(): Promise<SurveyEditorPage> {
    await this.startFromScratchButton.click();
    return new SurveyEditorPage(this.page);
  }
}
