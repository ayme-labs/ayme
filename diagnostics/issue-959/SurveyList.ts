import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

const record = (kind: string, detail: object = {}) =>
  (window as any).diagnostic.record(kind, detail);

async function canReadLink(self: SurveyRow) {
  const start = performance.now();
  const hidden = !!self.root && document.body.style.pointerEvents === "none";
  try {
    return !!(await self.root.getByRole("link").getAttribute("href"));
  } finally {
    record("predicate", { hidden, ms: performance.now() - start });
  }
}

@ayme({ root: (self: SurveyRow) => self.root })
export class SurveyRow {
  constructor(readonly root: Locator) {}

  @ayme.action
  async openOptions() {
    await this.root.getByTestId("survey-dropdown-trigger").click();
  }

  @ayme.action({ available: canReadLink })
  async archive() {}

  @ayme.action({ available: canReadLink })
  async duplicate() {}
}

@ayme
export class SurveyList {
  constructor(private readonly page: Page) {}

  async rows(): Promise<SurveyRow[]> {
    return (await this.page.locator(".survey-row").all()).map(
      (root) => new SurveyRow(root)
    );
  }

  @ayme.action
  async setCompleted(mode: "hover" | "click") {
    const trigger = this.page.getByRole("menuitem", {
      name: "Change status",
      exact: true,
    });
    record("action-start", { mode });
    if (mode === "hover") await trigger.hover({ timeout: 3000 });
    else await trigger.click({ timeout: 3000 });
    record("trigger-done", {
      itemPresent: !!document.querySelector(
        '[data-testid="survey-status-option-completed"]'
      ),
    });
    // Diagnostic control for Radix's remembered pointer direction, not a fix.
    if (new URLSearchParams(location.search).get("prime") === "left") {
      const box = await trigger.boundingBox();
      if (!box) throw new Error("No trigger box");
      await this.page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }
    await this.page
      .getByTestId("survey-status-option-completed")
      .click({ timeout: 3000 });
    record("item-done");
  }
}
