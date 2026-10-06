/**
 * Signs the seeded user in and opens the survey editor in the browser profile
 * the arm's interface then uses. Runs before the measured window, through the
 * Playwright that ships with the pinned Playwright MCP, on the same browser.
 */
import { createRequire } from "node:module";

import { playwrightMcpRoot } from "./arms.ts";
import type { Mission } from "./missions.ts";

type Locator = {
  waitFor(options: { timeout: number }): Promise<void>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
};

type Page = {
  goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded"; timeout?: number }
  ): Promise<unknown>;
  url(): string;
  evaluate<T, A = undefined>(
    pageFunction: (argument: A) => T | Promise<T>,
    argument?: A
  ): Promise<T>;
  getByRole(role: string, options: { name: string }): Locator;
  getByPlaceholder(text: string): Locator;
  request: {
    post(
      url: string,
      options: { data: object }
    ): Promise<{ ok(): boolean; status(): number }>;
  };
  waitForTimeout(ms: number): Promise<void>;
};

export type BrowserContext = {
  newPage(): Promise<Page>;
  pages(): Page[];
  addCookies(
    cookies: { name: string; value: string; url: string }[]
  ): Promise<void>;
  close(): Promise<void>;
  browser(): { version(): string } | null;
};

type Chromium = {
  launchPersistentContext(
    userDataDir: string,
    options: {
      channel?: string;
      headless: boolean;
      viewport: { width: number; height: number };
    }
  ): Promise<BrowserContext>;
};

export const viewport = { width: 1280, height: 720 };

/** The Playwright that ships with the pinned Playwright MCP; the harness's own browser work goes through it. */
export function playwright(): { chromium: Chromium } {
  // The Playwright the MCP server itself runs on, so profile and browser build match.
  const requireFromMcp = createRequire(`${playwrightMcpRoot}/package.json`);
  return requireFromMcp("playwright") as { chromium: Chromium };
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/**
 * Signs in through Formbricks's credential endpoint (the cookie lands in the
 * profile), then opens the editor and waits for its Save & Close button, which
 * also warms the page. Lands elsewhere while SpiceDB catches up, so it retries.
 */
export async function signInAndOpenEditor(options: {
  mission: Mission;
  baseUrl: string;
  profileDir: string;
  channel: string;
  /** Pages to open after the editor, signed in, in this order. For warming a suite's routes. */
  alsoVisit?: string[];
  log: (line: string) => void;
}): Promise<{ browserVersion: string | null }> {
  const {
    mission,
    baseUrl,
    profileDir,
    channel,
    alsoVisit = [],
    log,
  } = options;
  const context = await playwright().chromium.launchPersistentContext(
    profileDir,
    { channel, headless: true, viewport }
  );
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const response = await page.request.post(
      `${baseUrl}/api/auth/sign-in/email`,
      {
        data: { email: mission.user.email, password: mission.user.password },
      }
    );
    if (!response.ok())
      throw new SignInError(
        `Formbricks rejected the seeded credentials with HTTP ${response.status()}.`
      );

    // A dev server compiles a route on its first visit, slower still on a busy machine; this all
    // happens before the measured window, so a page gets far longer than Playwright's 30 s default.
    const navigationTimeoutMs = 180_000;
    const attempts = 6;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await page.goto(mission.startUrl, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeoutMs,
      });
      try {
        await page
          .getByRole("button", { name: "Save & Close" })
          .waitFor({ timeout: 60_000 });
        for (const url of alsoVisit)
          await page.goto(url, { timeout: navigationTimeoutMs });
        return { browserVersion: context.browser()?.version() ?? null };
      } catch {
        log(
          `Sign-in attempt ${attempt}/${attempts} landed on ${page.url()}; retrying.`
        );
        await page.waitForTimeout(2_000);
      }
    }
    throw new SignInError(
      `The editor at ${mission.startUrl} did not open after sign-in; the browser ended on ${context.pages()[0]?.url() ?? "no page"}.`
    );
  } finally {
    // Closing writes the session cookie to the profile for the arm's browser to pick up.
    await context.close();
  }
}

/**
 * The script the arm's browser runs on each new page: open the mission's start
 * URL on a blank page, so the agent's first look is the editor.
 */
export function initPageScript(startUrl: string) {
  return `// Written by the eval harness for one run. Runs on each new page of the agent's browser.
module.exports = {
  default: async ({ page }) => {
    if (page.url() === "about:blank") {
      await page.goto(${JSON.stringify(startUrl)});
    }
  },
};
`;
}
