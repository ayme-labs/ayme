import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";
import { SurveyEditorPage } from "./SurveyEditorPage";

/** The warning Formbricks shows before it opens the editor of a survey that has responses. */
export class EditActiveSurveyDialog extends AppComponent {
  @ayme.child
  readonly editButton: Locator;
  @ayme.child
  readonly duplicateAndEditButton: Locator;

  constructor(root: Locator) {
    super(root);
    this.editButton = root.getByRole("button", { name: "Edit", exact: true });
    this.duplicateAndEditButton = root.getByRole("button", {
      name: "Duplicate & edit",
      exact: true,
    });
  }

  @ayme.action({
    description:
      "Edits the survey itself, responses and all, rather than a copy.",
  })
  async edit(): Promise<SurveyEditorPage> {
    await this.editButton.click();
    return new SurveyEditorPage(this.root.page());
  }
}
