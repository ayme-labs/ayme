import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";
import type { SurveyEditorPage } from "./SurveyPages";

/** The warning Formbricks shows before it opens the editor of a survey that has responses. */
export class EditActiveSurveyDialog extends AppComponent {
  constructor(
    root: Locator,
    private readonly createEditorPage: () => SurveyEditorPage
  ) {
    super(root);
  }

  @ayme.child
  get editButton(): Locator {
    return this.root.getByRole("button", { name: "Edit", exact: true });
  }

  @ayme.child
  get duplicateAndEditButton(): Locator {
    return this.root.getByRole("button", {
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
    return this.createEditorPage();
  }
}
