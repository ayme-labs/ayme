import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

const onPage = (self: AppPage) =>
  new URLPattern({ pathname: self.path }).test(self.page.url());

/** A page of the fixture app, present while the browser is on its path. */
@ayme({ present: onPage })
export abstract class AppPage {
  abstract readonly path: string;

  constructor(readonly page: Page) {}
}
