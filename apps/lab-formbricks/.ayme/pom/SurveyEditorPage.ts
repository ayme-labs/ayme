import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
import { AppPage } from "./AppPage";
import { SurveySummaryPage } from "./SurveySummaryPage";

// Formbricks shows each save button only in some editors. An unavailable
// action reads which of this page's own buttons are there, and names the
// action that saves in their place.

const canSave = async (self: SurveyEditorPage) => {
  if (await self.saveButton.isVisible()) return true;
  if (await self.saveAsDraftButton.isVisible())
    return "This survey is a draft, and Formbricks shows Save only for a survey that is no longer one. Use SurveyEditorPage.saveAsDraft.";
  if (await self.saveAndCloseButton.isVisible())
    return "The editor a first survey opens in has no Save, only Save & Close. Use SurveyEditorPage.saveAndClose.";
  return "Formbricks shows Save only for a survey that is no longer a draft, and not in the editor a first survey opens in.";
};

const canSaveAndClose = async (self: SurveyEditorPage) => {
  if (await self.saveAndCloseButton.isVisible()) return true;
  if (await self.saveAsDraftButton.isVisible())
    return "This survey is a draft, which has Save & Close only in the editor a first survey opens in. Use SurveyEditorPage.saveAsDraft.";
  return "Formbricks shows Save & Close for a published survey, and for a draft only in the editor a first survey opens in.";
};

const canSaveAsDraft = async (self: SurveyEditorPage) => {
  if (await self.saveAsDraftButton.isVisible()) return true;
  if (await self.saveButton.isVisible())
    return "This survey is no longer a draft, and Formbricks shows Save as draft only for a draft. Use SurveyEditorPage.save, or SurveyEditorPage.saveAndClose to also leave the editor.";
  if (await self.saveAndCloseButton.isVisible())
    return "The editor a first survey opens in has no Save as draft, only Save & Close. Use SurveyEditorPage.saveAndClose.";
  return "Formbricks shows Save as draft only for a draft, and not in the editor a first survey opens in.";
};

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
  readonly saveButton: Locator;
  @ayme.child
  readonly saveAndCloseButton: Locator;
  @ayme.child
  readonly saveAsDraftButton: Locator;
  /** Shows for about two seconds after a save went through. */
  @ayme.child
  readonly changesSavedMessage: Locator;

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
    this.saveButton = page.getByRole("button", { name: "Save", exact: true });
    this.saveAndCloseButton = page.getByRole("button", {
      name: "Save & Close",
      exact: true,
    });
    this.saveAsDraftButton = page.getByRole("button", {
      name: "Save as draft",
      exact: true,
    });
    // A toast has no name or test id, so its text tells it from an error's.
    this.changesSavedMessage = page
      .locator("[data-rht-toaster]")
      .getByRole("status")
      .filter({ hasText: "Changes saved." });
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
    available: canSave,
    description:
      "Saves the changes to a survey that is no longer a draft. Its status stays as it is, a published survey stays published, and the editor stays open.",
  })
  async save() {
    await this.saveWith(this.saveButton);
    return this;
  }

  @ayme.action({
    available: canSaveAndClose,
    description:
      "Publishes a draft survey, so it starts collecting responses; saves a published one.",
  })
  async saveAndClose(): Promise<SurveySummaryPage> {
    await this.saveAndCloseButton.click();
    return new SurveySummaryPage(this.page);
  }

  @ayme.action({
    available: canSaveAsDraft,
    description:
      "Saves the changes without publishing: the survey stays a draft, which collects no responses, and the editor stays open.",
  })
  async saveAsDraft() {
    await this.saveWith(this.saveAsDraftButton);
    return this;
  }

  /** Saves with a button that keeps the editor open, and fails unless Formbricks confirms the save. */
  private async saveWith(button: Locator) {
    await button.click();
    // While Formbricks saves, the button shows a spinner in place of its
    // name, so it is back once the save has ended. The save is a round trip
    // to the server, which took 0.5 to 0.75 s on a warm dev server: too close
    // to the one second Ayme gives a wait, so this one has its own limit.
    await button.waitFor({ timeout: 5_000 });
    if (!(await this.changesSavedMessage.isVisible()))
      throw new Error("Formbricks did not save the survey.");
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
