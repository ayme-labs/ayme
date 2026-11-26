import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

import { AccountPage } from "./AccountPage";

/**
 * The fixture's `sign-in.html`, present there alone. Signing in submits its
 * form, a full page load, and leads to the account page.
 */
@ayme({
  present: (self: SignInPage) =>
    new URL(self.page.url()).pathname === "/sign-in.html",
})
export class SignInPage {
  constructor(readonly page: Page) {}

  @ayme.child
  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }

  @ayme.action({ description: "Sign in by name." })
  async signIn(name: string): Promise<AccountPage> {
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    await this.page.getByRole("button", { name: "Sign in" }).click();
    return new AccountPage(this.page);
  }
}
