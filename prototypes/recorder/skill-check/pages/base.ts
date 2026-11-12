import type { Locator, Page } from "@playwright/test";

export abstract class AppPage {
  constructor(readonly page: Page) {}
}

export abstract class AppComponent {
  constructor(readonly root: Locator) {}
}
