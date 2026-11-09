import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
import { AppPage } from "./AppPage";
import { SurveyNavigationPage } from "./SurveyNavigationPage";
import { NEXT_SCREEN_TIMEOUT } from "./timeouts";

export class SignInPage extends AppPage {
  readonly path = "/auth/login";

  @ayme.child
  readonly emailInput: Locator;
  @ayme.child
  readonly passwordInput: Locator;
  /** Shows the email form, then submits it. */
  @ayme.child
  readonly logInWithEmailButton: Locator;
  /** Why the sign-in failed: a toast, or a message under a field. */
  @ayme.child
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = page.getByLabel("Email", { exact: true });
    this.passwordInput = page.getByLabel("Password", { exact: true });
    // After a sign-in the button also shows "Last Used".
    this.logInWithEmailButton = page.getByRole("button", {
      name: /^Log in with Email(?: Last Used)?$/,
    });
    // Scoped to toasts, so a notice the page opens with, such as a verified email, is not an error.
    this.errorMessage = page
      .locator("[data-rht-toaster]")
      .getByRole("status")
      .or(page.locator("form").getByRole("alert"));
  }

  @ayme.action({
    description:
      "Lands where an organization without surveys creates its first one.",
  })
  async logIn(
    email: string,
    password: string
  ): Promise<SurveyNavigationPage | this> {
    // The button shows the form on its first click and submits it on the next.
    if (!(await this.emailInput.isVisible()))
      await this.logInWithEmailButton.click();
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.logInWithEmailButton.click();
    const navigationPage = new SurveyNavigationPage(this.page);
    await navigationPage.startFromScratchButton
      .or(this.errorMessage)
      .first()
      .waitFor({ timeout: NEXT_SCREEN_TIMEOUT });
    return (await this.errorMessage.first().isVisible())
      ? this
      : navigationPage;
  }
}
