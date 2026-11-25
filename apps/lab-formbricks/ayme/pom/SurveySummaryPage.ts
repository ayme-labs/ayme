import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppPage } from "./AppPage";
import { EditActiveSurveyDialog } from "./EditActiveSurveyDialog";
import { ShareSurveyDialog } from "./ShareSurveyDialog";
import { SurveyEditorPage } from "./SurveyEditorPage";

@ayme({
  description:
    "A survey's results. A survey published for the first time opens here with its share dialog.",
})
export class SurveySummaryPage extends AppPage {
  readonly path = "/workspaces/:workspaceId/surveys/:surveyId/summary";

  @ayme.child
  get surveyTitleHeading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }

  @ayme.child
  get editButton(): Locator {
    return this.page.getByRole("button", { name: "Edit", exact: true });
  }

  @ayme.child
  get shareSurveyDialog(): ShareSurveyDialog {
    // The share dialog has no accessible name, so it is found by its copy-link button.
    return new ShareSurveyDialog(
      this.page.getByRole("dialog").filter({
        has: this.page.getByRole("button", {
          name: "Copy survey link to clipboard",
          exact: true,
        }),
      })
    );
  }

  @ayme.child
  get editActiveSurveyDialog(): EditActiveSurveyDialog {
    return new EditActiveSurveyDialog(
      this.page.getByRole("dialog", {
        name: "Edit an active survey?",
        exact: true,
      })
    );
  }

  @ayme.action
  async edit(): Promise<SurveyEditorPage | EditActiveSurveyDialog> {
    await this.editButton.click();
    // A survey with responses asks first, in a dialog the click itself opens.
    return (await this.editActiveSurveyDialog.root.isVisible())
      ? this.editActiveSurveyDialog
      : new SurveyEditorPage(this.page);
  }
}
