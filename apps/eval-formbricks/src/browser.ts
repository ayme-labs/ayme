/**
 * Opens the mission's start page in the browser profile the arm's interface
 * then uses: the seeded survey's editor, signed in, or the sign-in page in a
 * fresh profile, signed out. Runs before the measured window, through the
 * Playwright that ships with the pinned Playwright MCP, on the same browser.
 */
import { createRequire } from "node:module";

import { playwrightMcpRoot } from "./arms.ts";
import { signInPath, type Mission } from "./missions.ts";

type Locator = {
  waitFor(options: { timeout: number }): Promise<void>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
};

export type Page = {
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
  waitForURL(url: RegExp, options?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
};

export type BrowserContext = {
  newPage(): Promise<Page>;
  pages(): Page[];
  addCookies(
    cookies: { name: string; value: string; url: string }[]
  ): Promise<void>;
  cookies(): Promise<{ name: string }[]>;
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
 * A dev server compiles a route on its first visit, slower still on a busy
 * machine; this all happens before the measured window, so a page gets far
 * longer than Playwright's 30 s default.
 */
export const navigationTimeoutMs = 180_000;

/** The name of the cookie Formbricks's session lives in, as its sign-in sets it. */
export function isSessionCookie(name: string) {
  return name.includes("session_token");
}

type StartOptions = {
  mission: Mission;
  baseUrl: string;
  profileDir: string;
  channel: string;
  log: (line: string) => void;
};

/**
 * Prepares the profile and opens the mission's start page once: signed in on
 * the editor, or signed out on the sign-in page. Either way the route is
 * compiled before the agent's browser opens it.
 */
export function openStartPage(
  options: StartOptions
): Promise<{ browserVersion: string | null }> {
  return options.mission.start.signedIn
    ? signInAndOpenEditor(options)
    : openSignInPage(options);
}

/** Signs in through Formbricks's credential endpoint; the session cookie lands in the context's profile. */
export async function signInThroughApi(
  page: Page,
  baseUrl: string,
  user: Mission["user"]
) {
  const response = await page.request.post(
    `${baseUrl}/api/auth/sign-in/email`,
    {
      data: { email: user.email, password: user.password },
    }
  );
  if (!response.ok())
    throw new SignInError(
      `Formbricks rejected the seeded credentials with HTTP ${response.status()}.`
    );
}

/**
 * Signs in through Formbricks's credential endpoint (the cookie lands in the
 * profile), then opens the editor and waits for its Save & Close button, which
 * also warms the page. Lands elsewhere while SpiceDB catches up, so it retries.
 */
async function signInAndOpenEditor(
  options: StartOptions
): Promise<{ browserVersion: string | null }> {
  const { mission, baseUrl, profileDir, channel, log } = options;
  const context = await playwright().chromium.launchPersistentContext(
    profileDir,
    { channel, headless: true, viewport }
  );
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await signInThroughApi(page, baseUrl, mission.user);
    await openEditor(page, mission.start.url, log);
    return { browserVersion: context.browser()?.version() ?? null };
  } finally {
    // Closing writes the session cookie to the profile for the arm's browser to pick up.
    await context.close();
  }
}

/** Opens the editor and waits for its Save & Close button, retrying while SpiceDB catches up. */
export async function openEditor(
  page: Page,
  editorUrl: string,
  log: (line: string) => void
) {
  const attempts = 6;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.goto(editorUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });
    try {
      await page
        .getByRole("button", { name: "Save & Close" })
        .waitFor({ timeout: 60_000 });
      return;
    } catch {
      log(
        `Opening the editor, attempt ${attempt}/${attempts}, landed on ${page.url()}; retrying.`
      );
      await page.waitForTimeout(2_000);
    }
  }
  throw new SignInError(
    `The editor at ${editorUrl} did not open; the browser ended on ${page.url()}.`
  );
}

/**
 * Opens the sign-in page in the fresh profile and waits for its sign-in
 * button, so the route is compiled, and checks that nothing signed the
 * profile in: the agent must start signed out.
 */
async function openSignInPage(
  options: StartOptions
): Promise<{ browserVersion: string | null }> {
  const { mission, profileDir, channel } = options;
  const context = await playwright().chromium.launchPersistentContext(
    profileDir,
    { channel, headless: true, viewport }
  );
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(mission.start.url, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });
    await page
      .getByRole("button", { name: "Log in with Email" })
      .waitFor({ timeout: 60_000 });
    if (new URL(page.url()).pathname !== signInPath)
      throw new SignInError(
        `The sign-in page at ${mission.start.url} sent the browser to ${page.url()}.`
      );
    const sessionCookies = (await context.cookies()).filter((cookie) =>
      isSessionCookie(cookie.name)
    );
    if (sessionCookies.length > 0)
      throw new SignInError(
        `The fresh profile holds a session cookie (${sessionCookies.map((cookie) => cookie.name).join(", ")}); the agent must start signed out.`
      );
    return { browserVersion: context.browser()?.version() ?? null };
  } finally {
    await context.close();
  }
}

/**
 * The script the arm's browser runs on each new page: open the mission's start
 * URL on a blank page, so the agent's first look is the start page.
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
