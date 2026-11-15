import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

const onPage = (self: FixturePage) =>
  new URL(self.page.url()).pathname === self.path;

/** A page of the fixture app: on the page while the browser is at its path. */
@ayme({ present: onPage })
export abstract class FixturePage {
  abstract readonly path: string;
  constructor(readonly page: Page) {}
}
