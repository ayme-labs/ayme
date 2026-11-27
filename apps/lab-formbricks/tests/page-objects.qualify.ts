import { fileURLToPath } from "node:url";

import { runAyme } from "@ayme-dev/cli/testing";
import {
  type Browser,
  type Locator,
  type Page,
  chromium,
  expect,
  test as base,
} from "@playwright/test";

import { SignInPage } from "#pom/SignInPage";
import { SurveyNavigationPage } from "#pom/SurveyNavigationPage";
import { SurveyEditorPage, SurveySummaryPage } from "#pom/SurveyPages";
import {
  disconnect,
  seedResponse,
  seedUser,
  storedSurvey,
  waitForAuthorization,
} from "./seed";

// The qualification drives the Page Objects with Playwright, and through
// the `ayme` command as an agent does: a Session started in the lab app's
// folder builds them and runs them in Node, on the browser it opened, and
// the test's own Playwright connection to that browser plays the agent's
// browser automation. The lab app, which ships no ayme, gets nothing of ayme
// in the page. It needs the lab app running (pnpm lab:dev).

/** The lab app's folder, where a Session finds `ayme/page-objects.ts`. */
const LAB_DIR = fileURLToPath(new URL("..", import.meta.url));

/** What one `ayme` command answered with `--json`. */
type Answer = { ok: boolean; text: string; data?: unknown };

/**
 * How long one `ayme` command may run before the test stops it: `open`
 * waits for the dev server to compile the sign-in page, which can take a
 * minute.
 */
const COMMAND_LIMIT_MS = 120_000;

/** The `ayme` command, run in the lab app's folder on the test's Session. */
type Agent = {
  /** The address of the Session's browser, which `ayme open` printed. */
  address: string;
  run(...args: string[]): Promise<Answer>;
  /** Calls the Page Object Tool `name` with `params` as its parameters. */
  call(name: string, params?: Record<string, unknown>): Promise<Answer>;
  /** The names of the Page Object Tools `ayme tools` lists, available or not. */
  toolNames(): Promise<string[]>;
};

const test = base.extend<{
  /**
   * Runs the `ayme` command in the lab app's folder with `--json`, with a
   * cache folder of the test's own, so it never finds a developer's own
   * Session there. After the test it closes the test's Session, and its
   * browser with it, also one still starting or one whose start failed.
   */
  ayme: (...args: string[]) => Promise<Answer>;
  /** The `ayme` command on a Session the test opened on the sign-in page. */
  agent: Agent;
  /** The Session's page, as the test's browser automation reaches it. */
  page: Page;
}>({
  // Playwright reads a fixture's dependencies from this pattern.
  // eslint-disable-next-line no-empty-pattern
  ayme: async ({}, use, testInfo) => {
    const env = {
      ...process.env,
      AYME_CACHE_DIR: testInfo.outputPath("cache"),
    };
    const run = async (...args: string[]): Promise<Answer> => {
      const command = `ayme ${args.join(" ")}`;
      const { code, stdout, stderr } = await runAyme([...args, "--json"], {
        cwd: LAB_DIR,
        env,
        signal: AbortSignal.timeout(COMMAND_LIMIT_MS),
      });
      try {
        return JSON.parse(code === 0 ? stdout : stderr) as Answer;
      } catch {
        throw new Error(
          `${command} exited with ${code} and answered no JSON.\nstdout: ${stdout}\nstderr: ${stderr}`
        );
      }
    };
    await use(run);
    await test.step("close the Session", async () => {
      const closed = await run("close");
      if (closed.ok) return;
      // No Session to close: it ended, or never started.
      const listed = await run("list");
      expect(
        (listed.data as { sessions: unknown[] } | undefined)?.sessions,
        `ayme close answered: ${closed.text}\nayme list answered: ${listed.text}`
      ).toEqual([]);
    });
  },
  agent: async ({ ayme, baseURL }, use) => {
    const opened = await ayme("open", new URL("/auth/login", baseURL).href);
    expect(opened.ok, opened.text).toBe(true);
    await use({
      address: (opened.data as { address: string }).address,
      run: ayme,
      call: (name, params = {}) =>
        ayme("call", name, "--params", JSON.stringify(params)),
      async toolNames() {
        const listed = await ayme("tools");
        expect(listed.ok, listed.text).toBe(true);
        return (listed.data as { tools: { name: string }[] }).tools.map(
          (tool) => tool.name
        );
      },
    });
  },
  page: async ({ agent }, use) => {
    const browser = await chromium.connectOverCDP(agent.address);
    try {
      await use(browser.contexts()[0]!.pages()[0]!);
    } finally {
      await browser.close();
    }
  },
});

test.afterAll(disconnect);

async function expectExactlyOnce(locator: Locator): Promise<void> {
  await expect(locator).toHaveCount(1);
  await expect(locator).toBeVisible();
}

/** Waits until `ayme tools` lists `names` among the screen's tools. */
async function expectTools(agent: Agent, names: string[]): Promise<void> {
  // Polls the names still missing, so a failure names them rather than a truncated list.
  await expect
    .poll(async () => {
      const listed = await agent.toolNames();
      return names.filter((name) => !listed.includes(name));
    })
    .toEqual([]);
}

/**
 * How a call names the one Page Object of `className` on the page, as the
 * input of a rooted Page Object Tool: by its Page Object id, which
 * `ayme page-objects` prints after its class name. Every call of a rooted tool
 * below names its Page Object through here.
 */
async function named(
  agent: Agent,
  className: string
): Promise<Record<string, unknown>> {
  const { text: tree, ok } = await agent.run("page-objects");
  expect(ok, tree).toBe(true);
  const id = new RegExp(`\\b${className} (po\\d+)`).exec(tree)?.[1];
  expect(id, `no ${className} in:\n${tree}`).toBeDefined();
  return { id };
}

/**
 * Formbricks renders a page on the server, and a click on it does nothing
 * until React has attached its handlers, which on a dev server takes a while
 * after a page load.
 */
async function expectHydrated(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps$"))
      )
    )
    .toBe(true);
}

/** The id of the survey Formbricks creates next from `page`, once it answers. */
async function createdSurveyId(page: Page): Promise<string> {
  const response = await page.waitForResponse((response) => {
    const { pathname } = new URL(response.url());
    return (
      (pathname === "/api/v3/surveys" ||
        pathname === "/api/v3/surveys/templates") &&
      response.request().method() === "POST"
    );
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { data?: { id?: unknown } };
  return String(body.data?.id);
}

/** The editor as a survey opens in it from the survey list, not as a first survey does (`?mode=cx`). */
const editorPath = (workspaceId: string, surveyId: string) =>
  `/workspaces/${workspaceId}/surveys/${surveyId}/edit`;

/**
 * Turbopack compiles each route and each server action on its first use,
 * which on a fresh dev server takes longer than `saveAsDraft` waits for its
 * save and than the assertions below wait for a screen. So a throwaway user
 * first walks the screens with Playwright alone, which waits as long as the
 * test may run.
 */
async function compileScreens(browser: Browser): Promise<void> {
  const user = await seedUser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const signInPage = new SignInPage(page);
    await page.goto("/auth/login");
    await expectHydrated(signInPage.logInWithEmailButton);
    await signInPage.logIn(user.email, user.password);

    const surveyId = createdSurveyId(page);
    await new SurveyNavigationPage(page).startFromScratchButton.click();
    await waitForAuthorization([await surveyId]);
    const editor = new SurveyEditorPage(page);
    await editor.saveAndCloseButton.waitFor();
    await page.goto(editorPath(user.workspaceId, await surveyId));
    await expectHydrated(editor.saveAsDraftButton);
    await editor.saveAsDraftButton.click();
    await editor.changesSavedMessage.waitFor();
    await page.goto(`${editorPath(user.workspaceId, await surveyId)}?mode=cx`);
    await expectHydrated(editor.saveAndCloseButton);
    await editor.saveAndCloseButton.click();
    await new SurveySummaryPage(page).shareSurveyDialog.root.waitFor();
    await page.goto(editorPath(user.workspaceId, await surveyId));
    await expectHydrated(editor.saveButton);
    await editor.saveButton.click();
    await editor.changesSavedMessage.waitFor();
  } finally {
    await context.close();
  }
}

test("a Session started in the lab app's folder lists the sign-in screen's Page Object Tool and no other screen's", async ({
  agent,
}) => {
  // `ayme open` opened the sign-in page. Each page is present on its own
  // path, so the Session lists only the current screen's Page Object Tools.
  expect((await agent.toolNames()).sort()).toEqual(["SignInPage.logIn"]);
});

test("each page object locator resolves exactly once in its intended state, and every action called through the ayme command takes effect", async ({
  baseURL,
  browser,
  page,
  agent,
}) => {
  await test.step("compile the screens", () => compileScreens(browser));
  const user = await seedUser();

  // The agent calls the page objects through the ayme command, so the
  // actions are checked the same way; the locators are checked with Playwright.
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const result = await agent.call(name, input);
    expect(result.ok, `${name}: ${result.text}`).toBe(true);
  };
  // The Session's page has no base URL of its own.
  const goto = (path: string) => page.goto(new URL(path, baseURL).href);
  const signInPage = new SignInPage(page);
  await goto("/auth/login");
  await expectTools(agent, ["SignInPage.logIn"]);
  await expectExactlyOnce(signInPage.logInWithEmailButton);
  await expect(signInPage.emailInput).toHaveCount(0);
  await expectHydrated(signInPage.logInWithEmailButton);

  // A refused sign-in stays on the page and says why.
  await call("SignInPage.logIn", {
    email: user.email,
    password: `not ${user.password}`,
  });
  await expectExactlyOnce(signInPage.errorMessage);
  await expect(page).toHaveURL(/\/auth\/login/);
  await expectExactlyOnce(signInPage.emailInput);
  await expectExactlyOnce(signInPage.passwordInput);
  // The message is a toast, which goes by itself.
  await expect(signInPage.errorMessage).toHaveCount(0);

  // A new organization without surveys is sent to create its first survey.
  await call("SignInPage.logIn", {
    email: user.email,
    password: user.password,
  });
  const surveyNavigationPage = new SurveyNavigationPage(page);
  await page.waitForURL(
    new RegExp(`/organizations/${user.organizationId}/workspaces/new/survey`)
  );
  await expectExactlyOnce(surveyNavigationPage.startFromScratchButton);
  await expectTools(agent, ["SurveyNavigationPage.startFromScratch"]);

  const created = createdSurveyId(page);
  await call("SurveyNavigationPage.startFromScratch");
  const surveyEditorPage = new SurveyEditorPage(page);
  const surveyId = await created;
  await waitForAuthorization([surveyId]);
  await page.waitForURL(
    new RegExp(`/workspaces/${user.workspaceId}/surveys/${surveyId}/edit`)
  );

  await expectExactlyOnce(surveyEditorPage.surveyNameInput);
  await expectExactlyOnce(surveyEditorPage.questionTextEditor);
  await expectExactlyOnce(surveyEditorPage.saveAndCloseButton);
  await expectTools(agent, [
    "SurveyEditorPage.fillSurveyForm",
    "SurveyEditorPage.save",
    "SurveyEditorPage.saveAndClose",
    "SurveyEditorPage.saveAsDraft",
  ]);

  // The editor a first survey opens in has no Save as draft, and the action
  // says so.
  await expect(surveyEditorPage.saveAsDraftButton).toHaveCount(0);
  const refused = await agent.call("SurveyEditorPage.saveAsDraft");
  expect(refused.ok, refused.text).toBe(false);
  expect(refused.text).toContain(
    "The editor a first survey opens in has no Save as draft, only Save & Close."
  );
  // Nor a Save, which a draft has nowhere.
  await expect(surveyEditorPage.saveButton).toHaveCount(0);
  const noSaveYet = await agent.call("SurveyEditorPage.save");
  expect(noSaveYet.ok, noSaveYet.text).toBe(false);
  expect(noSaveYet.text).toContain(
    "The editor a first survey opens in has no Save, only Save & Close."
  );

  // The editor a draft opens in from the survey list has it.
  await goto(editorPath(user.workspaceId, surveyId));
  await expectExactlyOnce(surveyEditorPage.saveAsDraftButton);
  await expectHydrated(surveyEditorPage.saveAsDraftButton);
  await expect(surveyEditorPage.saveAndCloseButton).toHaveCount(0);
  await expectTools(agent, [
    "SurveyEditorPage.saveAndClose",
    "SurveyEditorPage.saveAsDraft",
  ]);
  // It has no Save & Close, and that action says why.
  const noSaveAndClose = await agent.call("SurveyEditorPage.saveAndClose");
  expect(noSaveAndClose.ok, noSaveAndClose.text).toBe(false);
  expect(noSaveAndClose.text).toContain(
    "This survey is a draft, which has Save & Close only in the editor a first survey opens in."
  );
  await expect(surveyEditorPage.saveButton).toHaveCount(0);
  const noSave = await agent.call("SurveyEditorPage.save");
  expect(noSave.ok, noSave.text).toBe(false);
  expect(noSave.text).toContain(
    "This survey is a draft, and Formbricks shows Save only for a survey that is no longer one."
  );
  const draftName = `ayme lab draft ${surveyId}`;
  await call("SurveyEditorPage.fillSurveyForm", { name: draftName });
  await call("SurveyEditorPage.saveAsDraft");
  // The action returned once the save had ended, and the survey is not published.
  expect(await storedSurvey(surveyId)).toEqual({
    name: draftName,
    status: "draft",
  });
  await expect(page).toHaveURL(
    new RegExp(`${editorPath(user.workspaceId, surveyId)}$`)
  );

  await goto(`${editorPath(user.workspaceId, surveyId)}?mode=cx`);
  await expectExactlyOnce(surveyEditorPage.saveAndCloseButton);
  await expectHydrated(surveyEditorPage.saveAndCloseButton);
  await expect(surveyEditorPage.surveyNameInput).toHaveValue(draftName);
  await expectTools(agent, ["SurveyEditorPage.saveAndClose"]);

  const surveyName = `ayme lab qualification ${surveyId}`;
  const questionText = `What should the lab check next? ${surveyId}`;
  await call("SurveyEditorPage.fillSurveyForm", {
    name: surveyName,
    questionText,
  });
  await expect(surveyEditorPage.surveyNameInput).toHaveValue(surveyName);
  await expect(surveyEditorPage.questionTextEditor).toHaveText(questionText);
  await call("SurveyEditorPage.saveAndClose");

  await page.waitForURL(
    new RegExp(`/workspaces/${user.workspaceId}/surveys/${surveyId}/summary`)
  );
  const surveySummaryPage = new SurveySummaryPage(page);
  // Saving a new survey opens its sharing dialog over the summary.
  await expectExactlyOnce(surveySummaryPage.shareSurveyDialog.root);
  await expectExactlyOnce(surveySummaryPage.shareSurveyDialog.closeButton);
  await expectTools(agent, [
    "ShareSurveyDialog.close",
    "SurveySummaryPage.edit",
  ]);
  await call(
    "ShareSurveyDialog.close",
    await named(agent, "ShareSurveyDialog")
  );
  await expect(surveySummaryPage.shareSurveyDialog.root).toHaveCount(0);
  await expectExactlyOnce(surveySummaryPage.surveyTitleHeading);
  await expect(surveySummaryPage.surveyTitleHeading).toHaveText(surveyName);
  await expectExactlyOnce(surveySummaryPage.editButton);

  await call("SurveySummaryPage.edit");
  const reopened = surveyEditorPage;
  await page.waitForURL(
    new RegExp(`/workspaces/${user.workspaceId}/surveys/${surveyId}/edit`)
  );
  await expect(reopened.surveyNameInput).toHaveValue(surveyName);

  // The editor of a published survey has Save and Save & Close and no Save
  // as draft, whose action says the survey is no longer a draft.
  await expectExactlyOnce(reopened.saveButton);
  await expectExactlyOnce(reopened.saveAndCloseButton);
  await expect(reopened.saveAsDraftButton).toHaveCount(0);
  await expectTools(agent, [
    "SurveyEditorPage.save",
    "SurveyEditorPage.saveAsDraft",
  ]);
  const notADraft = await agent.call("SurveyEditorPage.saveAsDraft");
  expect(notADraft.ok, notADraft.text).toBe(false);
  expect(notADraft.text).toContain(
    "This survey is no longer a draft, and Formbricks shows Save as draft only for a draft."
  );
  const publishedName = `ayme lab published ${surveyId}`;
  await call("SurveyEditorPage.fillSurveyForm", { name: publishedName });
  await call("SurveyEditorPage.save");
  // The action returned once the save had ended; the survey stays published and the editor open.
  expect(await storedSurvey(surveyId)).toEqual({
    name: publishedName,
    status: "inProgress",
  });
  await expect(page).toHaveURL(
    new RegExp(`${editorPath(user.workspaceId, surveyId)}$`)
  );

  // A survey with responses asks before it opens in the editor.
  await seedResponse(surveyId);
  await goto(`/workspaces/${user.workspaceId}/surveys/${surveyId}/summary`);
  await expectExactlyOnce(surveySummaryPage.editButton);
  await expectHydrated(surveySummaryPage.editButton);
  await call("SurveySummaryPage.edit");
  const dialog = surveySummaryPage.editActiveSurveyDialog;
  await expectExactlyOnce(dialog.root);
  await expectExactlyOnce(dialog.editButton);
  await expectExactlyOnce(dialog.duplicateAndEditButton);
  await expectTools(agent, ["EditActiveSurveyDialog.edit"]);
  await call(
    "EditActiveSurveyDialog.edit",
    await named(agent, "EditActiveSurveyDialog")
  );
  await page.waitForURL(
    new RegExp(`${editorPath(user.workspaceId, surveyId)}$`)
  );
  await expect(surveyEditorPage.surveyNameInput).toHaveValue(publishedName);
});
