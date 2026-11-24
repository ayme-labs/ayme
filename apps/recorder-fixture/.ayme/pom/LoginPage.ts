import { ayme } from "@ayme-dev/ayme";

import { FixturePage } from "./FixturePage";

export class LoginPage extends FixturePage {
  readonly path = "/login.html";

  @ayme.child({
    description:
      '"Logged in as <user>" once the page has its session cookie and its local storage entry, else "Not logged in".',
  })
  readonly who = this.page.locator("#who");
  @ayme.child({
    description: "Sets the session cookie and the local storage entry.",
  })
  readonly logInButton = this.page.getByRole("button", { name: "Log in" });
  @ayme.child({
    description: "Goes to the cart on another origin of the same server.",
  })
  readonly elsewhereLink = this.page.getByRole("link", {
    name: "Go elsewhere",
  });
}
