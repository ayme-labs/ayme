import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppPage } from "./AppPage";
import { SurveyNavigationPage } from "./SurveyNavigationPage";

export class SignInPage extends AppPage {
  readonly path = "/auth/login";

  @ayme.child
  get emailInput(): Locator {
    return this.page.getByLabel("Email", { exact: true });
  }

  @ayme.child
  get passwordInput(): Locator {
    return this.page.getByLabel("Password", { exact: true });
  }

  /** Shows the email form, then submits it. */
  @ayme.child
  get logInWithEmailButton(): Locator {
    // After a sign-in the button also shows "Last Used".
    return this.page.getByRole("button", {
      name: /^Log in with Email(?: Last Used)?$/,
    });
  }

  /** Why the sign-in failed: a toast, or a message under a field. */
  @ayme.child
  get errorMessage(): Locator {
    // Scoped to toasts, so a notice the page opens with, such as a verified email, is not an error.
    return this.page
      .locator("[data-rht-toaster]")
      .getByRole("status")
      .or(this.page.locator("form").getByRole("alert"));
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
    await this.fillCredentials(email, password);
    await this.logInWithEmailButton.click();
    // A sign-in that went through shows nothing here before Formbricks leaves
    // the page, so the one outcome to see on this page is the error, which a
    // refused sign-in showed after 0.3 s. Without one within ayme's own limit
    // for a wait, stated here for Playwright, which has none, the sign-in is
    // taken to have gone through.
    const refused = await this.errorMessage
      .first()
      .waitFor({ timeout: 1_000 })
      .then(
        () => true,
        () => false
      );
    return refused ? this : new SurveyNavigationPage(this.page);
  }

  private async fillCredentials(email: string, password: string) {
    // Formbricks focuses the email input a tenth of a second after it shows
    // the form, which sends a password being filled just then into the email
    // input. So fill, check that both inputs kept their values, and fill
    // again when they did not.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.emailInput.fill(email);
      await this.passwordInput.fill(password);
      if (
        (await this.emailInput.inputValue()) === email &&
        (await this.passwordInput.inputValue()) === password
      )
        return;
    }
    throw new Error("The sign-in form did not keep the email and password.");
  }
}
