import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
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
  readonly surveyTitleHeading: Locator;
  @ayme.child
  readonly editButton: Locator;
  @ayme.child
  readonly shareSurveyDialog: ShareSurveyDialog;
  @ayme.child
  readonly editActiveSurveyDialog: EditActiveSurveyDialog;

  constructor(page: Page) {
    super(page);
    this.surveyTitleHeading = page.getByRole("heading", { level: 1 });
    this.editButton = page.getByRole("button", { name: "Edit", exact: true });
    // The share dialog has no accessible name, so it is found by its copy-link button.
    this.shareSurveyDialog = new ShareSurveyDialog(
      page.getByRole("dialog").filter({
        has: page.getByRole("button", {
          name: "Copy survey link to clipboard",
          exact: true,
        }),
      })
    );
    this.editActiveSurveyDialog = new EditActiveSurveyDialog(
      page.getByRole("dialog", { name: "Edit an active survey?", exact: true })
    );
  }

  @ayme.action
  async edit(): Promise<SurveyEditorPage | EditActiveSurveyDialog> {
    await this.editButton.click();
    // A survey with responses asks first.
    const editor = new SurveyEditorPage(this.page);
    await editor.surveyNameInput
      .or(this.editActiveSurveyDialog.root)
      .first()
      .waitFor();
    return (await this.editActiveSurveyDialog.root.isVisible())
      ? this.editActiveSurveyDialog
      : editor;
  }
}
