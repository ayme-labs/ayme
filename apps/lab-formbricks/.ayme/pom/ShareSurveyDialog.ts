import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";
import { Modal } from "./Modal";
import { SurveySummaryPage } from "./SurveySummaryPage";

/** Opens over the summary when a survey is published for the first time. */
export class ShareSurveyDialog extends AppComponent {
  @ayme.child
  readonly closeButton: Locator;
  private readonly modal: Modal;

  constructor(root: Locator) {
    super(root);
    this.modal = new Modal(root);
    this.closeButton = this.modal.closeButton;
  }

  @ayme.action
  async close(): Promise<SurveySummaryPage> {
    await this.modal.close();
    return new SurveySummaryPage(this.root.page());
  }
}
