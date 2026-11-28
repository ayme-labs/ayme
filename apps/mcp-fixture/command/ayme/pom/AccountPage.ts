import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * The fixture's `account.html`, present there alone. Its actions stand for
 * Page Object code that misbehaves: one waits until the test lets it go, one
 * throws, one waits on a timer that throws, and one leaves errors nothing
 * catches, which fire once the test lets them and its Run has answered.
 */
@ayme({
  present: (self: AccountPage) =>
    new URL(self.page.url()).pathname === "/account.html",
})
export class AccountPage {
  constructor(readonly page: Page) {}

  @ayme.child
  get heading(): Locator {
    return this.page.getByRole("heading", { level: 1 });
  }

  @ayme.action({
    description: "Wait until the page's window has `released`.",
  })
  async waitForRelease() {
    // No timeout: only the test ends the wait.
    await this.page.waitForFunction(() => "released" in window, null, {
      timeout: 0,
    });
  }

  @ayme.action({ description: "Fail, as an action that throws does." })
  async fail() {
    throw new Error("The account is locked.");
  }

  @ayme.action({
    description: "Wait on a timer whose callback throws before it resolves.",
  })
  async throwInTimer() {
    const check = (ok: boolean) => {
      if (!ok) throw new Error("The timer the action waits on failed.");
    };
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        check(false);
        resolve();
      })
    );
  }

  @ayme.action({
    description:
      "Leave an error and a rejection that nothing catches, which fire once the page's window has `leave`.",
  })
  async leaveUncaught() {
    void this.page
      .waitForFunction(() => "leave" in window, null, { timeout: 0 })
      .then(() => {
        void Promise.reject(new Error("A rejection nothing caught."));
        setTimeout(() => {
          throw new Error("An error nothing caught.");
        });
      });
  }
}
