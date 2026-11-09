import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
import { AppPage } from "./AppPage";
import { SurveySummaryPage } from "./SurveySummaryPage";
import { NEXT_SCREEN_TIMEOUT } from "./timeouts";

@ayme({
  description:
    "Edits one survey. A draft without a publish date saves itself every ten seconds; other surveys keep changes only once saved.",
})
export class SurveyEditorPage extends AppPage {
  readonly path = "/workspaces/:workspaceId/surveys/:surveyId/edit";

  @ayme.child
  readonly surveyNameInput: Locator;
  /** The text of the question open in the editor, the first one when the editor opens. */
  @ayme.child
  readonly questionTextEditor: Locator;
  @ayme.child
  readonly saveAndCloseButton: Locator;

  constructor(page: Page) {
    super(page);
    this.surveyNameInput = page.getByRole("textbox", {
      name: "Survey name",
      exact: true,
    });
    // The question text is a rich-text editor without an accessible name. Formbricks's own
    // Playwright helper finds it the same way: from the "Question*" label to its form group.
    this.questionTextEditor = page
      .locator('label:text-is("Question*")')
      .locator("..")
      .locator("..")
      .locator(".editor-input");
    this.saveAndCloseButton = page.getByRole("button", {
      name: "Save & Close",
      exact: true,
    });
  }

  @ayme.action({
    description:
      "Replaces the survey's name and the text of the question open in the editor, the first one when the editor opens. Leave out what stays as it is.",
  })
  async fillSurveyForm({
    name,
    questionText,
  }: {
    name?: string;
    questionText?: string;
  }) {
    if (name !== undefined) await this.surveyNameInput.fill(name);
    if (questionText !== undefined) await this.fillQuestionText(questionText);
    return this;
  }

  @ayme.action({
    description:
      "Publishes a draft survey, so it starts collecting responses; saves a published one.",
  })
  async saveAndClose(): Promise<SurveySummaryPage> {
    await this.saveAndCloseButton.click();
    const summary = new SurveySummaryPage(this.page);
    await summary.surveyTitleHeading.waitFor({ timeout: NEXT_SCREEN_TIMEOUT });
    return summary;
  }

  private async fillQuestionText(text: string) {
    // The rich-text editor takes a fill only once it is focused with its text selected, and loads
    // the question's stored text after it mounts, which can overwrite an early fill. So focus,
    // select, fill, and check that the text stayed, as Formbricks's own Playwright helper checks.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.questionTextEditor.click();
      await this.questionTextEditor.press("ControlOrMeta+A");
      await this.questionTextEditor.fill(text);
      if ((await this.questionTextEditor.textContent())?.trim() === text)
        return;
    }
    throw new Error("The question editor did not keep the new text.");
  }
}
