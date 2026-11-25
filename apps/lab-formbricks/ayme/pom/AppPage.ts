import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

const onPage = (self: AppPage) =>
  new URLPattern({ pathname: self.path }).test(self.page.url());

/** A Formbricks page, present while the browser is on its path. */
@ayme({ present: onPage })
export abstract class AppPage {
  /** The page's path as a URLPattern pathname, such as `/workspaces/:workspaceId/surveys`. */
  abstract readonly path: string;

  constructor(readonly page: Page) {}
}
