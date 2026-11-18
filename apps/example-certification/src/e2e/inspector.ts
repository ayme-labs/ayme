import type { Locator, Screen } from "e2e";

/**
 * The Inspector, as the examples' Inspector check drives it: an e2e-native
 * copy of the part of `Inspector` from `@ayme-dev/inspector/testing` that it
 * uses. That Page Object reaches the Inspector's closed shadow root through
 * its own Playwright selector engine; e2e's web engine records closed shadow
 * roots itself and searches them in every `screen` query, so this one needs
 * no engine.
 */
export class Inspector {
  constructor(private readonly screen: Screen) {}

  /** The expanded panel. */
  get panel(): Locator {
    return this.screen.getByRole("complementary", "ayme");
  }

  /** The collapsed panel's logo, which opens it. */
  get logo(): Locator {
    return this.screen.getByRole("button", "Open ayme");
  }

  /** Expands the panel if it is collapsed to the logo. */
  async open() {
    await this.panel.or(this.logo).waitFor();
    if (await this.logo.isVisible()) await this.logo.click();
    await this.panel.waitFor();
  }

  /** Selects a tool in the Tools lens and runs it with no arguments. */
  async runTool(name: string) {
    const navigator = this.panel.getByRole("navigation", "Navigator");
    await navigator
      .getByRole("group", "Lens")
      .getByRole("button", "Tools")
      .click();
    await navigator.getByRole("searchbox").fill("");
    await navigator.getByRole("button", name).click();
    await this.panel
      .getByRole("region", "Selected")
      .getByRole("form")
      .getByRole("button", "Run")
      .click();
  }
}
