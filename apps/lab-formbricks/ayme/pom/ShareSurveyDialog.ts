import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";
import { Modal } from "./Modal";
import { SurveySummaryPage } from "./SurveySummaryPage";

/** Opens over the summary when a survey is published for the first time. */
export class ShareSurveyDialog extends AppComponent {
  @ayme.child
  get closeButton(): Locator {
    return this.modal.closeButton;
  }

  private get modal(): Modal {
    return new Modal(this.root);
  }

  @ayme.action
  async close(): Promise<SurveySummaryPage> {
    await this.modal.close();
    return new SurveySummaryPage(this.root.page());
  }
}
