import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startAgent } from "@ayme-dev/mcp/testing";
import {
  type Browser,
  type Locator,
  type Page,
  expect,
  test as base,
} from "@playwright/test";

import { EditActiveSurveyDialog } from "../.ayme/pom/EditActiveSurveyDialog";
import { SignInPage } from "../.ayme/pom/SignInPage";
import { SurveyEditorPage } from "../.ayme/pom/SurveyEditorPage";
import { SurveyNavigationPage } from "../.ayme/pom/SurveyNavigationPage";
import { SurveySummaryPage } from "../.ayme/pom/SurveySummaryPage";
import {
  disconnect,
  seedResponse,
  seedUser,
  storedSurvey,
  waitForAuthorization,
} from "./seed";

// The qualification drives the Page Objects with Playwright; the lab app,
// which ships no Ayme, gets the same classes from an `ayme mcp` server, which
// builds them and loads them into the page through its init script. It needs
// the lab app running (pnpm lab:dev), and no other Ayme MCP server listening
// on ports 9350 to 9365: a page pairs by itself only with exactly one.
//
// WEBMCP: `ayme mcp` starts the served runtime with the Agent Connection only,
// so the page publishes nothing over `document.modelContext`, and the
// qualification reads the page's tools from the server, as an agent does.
// Started with `--webmcp`, the `webMcp` option of the `agent` fixture below,
// the page also publishes its Page Object Tools and the read tool
// `page_objects` there, which one test checks on the sign-in screen. The
// browser starts with Chrome's WebMCP flag (playwright.config.ts).

/** The lab app's folder, where `ayme mcp` finds `.ayme/page-objects.ts`. */
const LAB_DIR = fileURLToPath(new URL("..", import.meta.url));

/** Ayme in the lab app without Page Objects, relative to {@link LAB_DIR}. */
const NO_PAGE_OBJECTS_ENTRY = ".ayme/no-page-objects.ts";

const BROWSER_TOOLS = [
  "check",
  "click",
  "fill",
  "fill_form",
  "hover",
  "press_key",
  "select_option",
  "type",
  "uncheck",
];

type Agent = Awaited<ReturnType<typeof startAgent>>;

const test = base.extend<{
  /**
   * The entry `ayme mcp` serves, relative to the lab app's folder;
   * `.ayme/page-objects.ts` when undefined.
   */
  pageObjectsEntry: string | undefined;
  /** Whether `ayme mcp` starts with `--webmcp`, so the page also publishes through WebMCP. */
  webMcp: boolean;
  /**
   * An `ayme mcp` server started in the lab app's folder, whose init script
   * runs in every page of the test's context. One at a time: a page's scan
   * pairs only when it finds exactly one.
   */
  agent: Agent;
}>({
  pageObjectsEntry: [undefined, { option: true }],
  webMcp: [false, { option: true }],
  agent: async ({ context, pageObjectsEntry, webMcp }, use) => {
    const agent = await startAgent(
      { cwd: LAB_DIR },
      ...(pageObjectsEntry === undefined
        ? []
        : ["--page-objects", pageObjectsEntry]),
      ...(webMcp ? ["--webmcp"] : [])
    );
    try {
      // The server wrote it as it started, naming its port.
      await context.addInitScript({
        path: path.join(LAB_DIR, ".ayme/init-script.js"),
      });
      await use(agent);
    } finally {
      await agent.close();
    }
  },
});

test.afterAll(disconnect);

/** Page Object Tools are named `<page object>.<action>`; Ayme's own tools carry no dot. */
const pageObjectTools = (names: string[]) =>
  names.filter((name) => name.includes(".")).sort();

async function expectExactlyOnce(locator: Locator): Promise<void> {
  await expect(locator).toHaveCount(1);
  await expect(locator).toBeVisible();
}

/** Waits until the server lists `names` among the page's tools. */
async function expectTools(agent: Agent, names: string[]): Promise<void> {
  // Polls the names still missing, so a failure names them rather than a truncated list.
  await expect
    .poll(
      async () => {
        const listed = await agent.pageToolNames();
        return names.filter((name) => !listed.includes(name));
      },
      { message: agent.log }
    )
    .toEqual([]);
}

/** The names of the tools the page publishes over WebMCP now, as Chrome's `document.modelContext` lists them, sorted. */
function publishedToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const modelContext = (
      document as unknown as {
        modelContext?: { getTools(): Promise<{ name: string }[]> };
      }
    ).modelContext;
    const tools = (await modelContext?.getTools()) ?? [];
    return tools.map((tool) => tool.name).sort();
  });
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

test("an unmodified Formbricks page pairs with an ayme mcp server by itself and gets the Page Objects the server serves", async ({
  page,
  agent,
}) => {
  await page.goto("/auth/login");
  // The init script loaded the runtime and the Page Objects from the server,
  // and the page looked for the server as it loaded and paired with it, with
  // no link.
  await expectTools(agent, [...BROWSER_TOOLS, "snapshot", "SignInPage.logIn"]);
  // Each page is present on its own path, so the page offers only the current
  // screen's Page Object Tools.
  expect(pageObjectTools(await agent.pageToolNames())).toEqual([
    "SignInPage.logIn",
  ]);
});

test.describe("served the entry without Page Objects", () => {
  test.use({ pageObjectsEntry: NO_PAGE_OBJECTS_ENTRY });

  test("the page offers snapshot and the Browser Tools and no Page Object Tool", async ({
    page,
    agent,
  }) => {
    await page.goto("/auth/login");
    await expectTools(agent, [...BROWSER_TOOLS, "snapshot"]);
    expect(pageObjectTools(await agent.pageToolNames())).toEqual([]);
  });
});

test.describe("served with --webmcp", () => {
  test.use({ webMcp: true });

  test("document.modelContext lists the sign-in screen's Page Object Tool", async ({
    page,
    agent,
  }) => {
    await page.goto("/auth/login");
    await expect
      .poll(() => publishedToolNames(page), { message: agent.log })
      .toEqual(["SignInPage.logIn", "page_objects"]);
    // The server offers the same Page Object Tool as without the flag.
    await expectTools(agent, ["SignInPage.logIn"]);
  });
});

test("each page object locator resolves exactly once in its intended state, and each action called through an ayme mcp server takes effect", async ({
  browser,
  page,
  agent,
}) => {
  await test.step("compile the screens", () => compileScreens(browser));
  const user = await seedUser();

  // The agent calls the page objects through its server, in the page, so the
  // actions are checked the same way; the locators are checked with Playwright.
  const signInPage = new SignInPage(page);
  await page.goto("/auth/login");
  await expectTools(agent, ["SignInPage.logIn"]);
  await expectExactlyOnce(signInPage.logInWithEmailButton);
  await expect(signInPage.emailInput).toHaveCount(0);
  await expectHydrated(signInPage.logInWithEmailButton);

  // A refused sign-in stays on the page and says why.
  const rejected = await signInPage.logIn(user.email, `not ${user.password}`);
  assert(rejected === signInPage);
  await expectExactlyOnce(signInPage.errorMessage);
  await expectExactlyOnce(signInPage.emailInput);
  await expectExactlyOnce(signInPage.passwordInput);
  // The message is a toast, which goes by itself.
  await expect(signInPage.errorMessage).toHaveCount(0);

  // A new organization without surveys is sent to create its first survey.
  const surveyNavigationPage = await signInPage.logIn(
    user.email,
    user.password
  );
  assert(surveyNavigationPage instanceof SurveyNavigationPage);
  await page.waitForURL(
    new RegExp(`/organizations/${user.organizationId}/workspaces/new/survey`)
  );
  await expectExactlyOnce(surveyNavigationPage.startFromScratchButton);
  await expectTools(agent, ["SurveyNavigationPage.startFromScratch"]);

  const created = createdSurveyId(page);
  const surveyEditorPage = await surveyNavigationPage.startFromScratch();
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

  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const result = await agent.call(name, input);
    expect(result.isError, `${name}: ${result.text}`).toBe(false);
  };

  // The editor a first survey opens in has no Save as draft, and the action
  // says so and names the one that saves there.
  await expect(surveyEditorPage.saveAsDraftButton).toHaveCount(0);
  const refused = await agent.call("SurveyEditorPage.saveAsDraft");
  expect(refused.isError, refused.text).toBe(true);
  expect(refused.text).toContain("Use SurveyEditorPage.saveAndClose.");
  // Nor a Save, which a draft has nowhere.
  await expect(surveyEditorPage.saveButton).toHaveCount(0);
  const noSaveYet = await agent.call("SurveyEditorPage.save");
  expect(noSaveYet.isError, noSaveYet.text).toBe(true);
  expect(noSaveYet.text).toContain("Use SurveyEditorPage.saveAndClose.");

  // The editor a draft opens in from the survey list has it.
  await page.goto(editorPath(user.workspaceId, surveyId));
  await expectExactlyOnce(surveyEditorPage.saveAsDraftButton);
  await expectHydrated(surveyEditorPage.saveAsDraftButton);
  await expect(surveyEditorPage.saveAndCloseButton).toHaveCount(0);
  await expectTools(agent, [
    "SurveyEditorPage.saveAndClose",
    "SurveyEditorPage.saveAsDraft",
  ]);
  // It has no Save & Close, and that action says so and names Save as draft's.
  const noSaveAndClose = await agent.call("SurveyEditorPage.saveAndClose");
  expect(noSaveAndClose.isError, noSaveAndClose.text).toBe(true);
  expect(noSaveAndClose.text).toContain("Use SurveyEditorPage.saveAsDraft.");
  await expect(surveyEditorPage.saveButton).toHaveCount(0);
  const noSave = await agent.call("SurveyEditorPage.save");
  expect(noSave.isError, noSave.text).toBe(true);
  expect(noSave.text).toContain("Use SurveyEditorPage.saveAsDraft.");
  const draftName = `Ayme lab draft ${surveyId}`;
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

  await page.goto(`${editorPath(user.workspaceId, surveyId)}?mode=cx`);
  await expectExactlyOnce(surveyEditorPage.saveAndCloseButton);
  await expectHydrated(surveyEditorPage.saveAndCloseButton);
  await expect(surveyEditorPage.surveyNameInput).toHaveValue(draftName);
  await expectTools(agent, ["SurveyEditorPage.saveAndClose"]);

  const surveyName = `Ayme lab qualification ${surveyId}`;
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
  const summaryAfterShare = await surveySummaryPage.shareSurveyDialog.close();
  await expect(summaryAfterShare.shareSurveyDialog.root).toHaveCount(0);
  await expectExactlyOnce(surveySummaryPage.surveyTitleHeading);
  await expect(surveySummaryPage.surveyTitleHeading).toHaveText(surveyName);
  await expectExactlyOnce(surveySummaryPage.editButton);

  const reopened = await surveySummaryPage.edit();
  assert(reopened instanceof SurveyEditorPage);
  await page.waitForURL(
    new RegExp(`/workspaces/${user.workspaceId}/surveys/${surveyId}/edit`)
  );
  await expect(reopened.surveyNameInput).toHaveValue(surveyName);

  // The editor of a published survey has Save and Save & Close and no Save
  // as draft, whose action names the two that save there.
  await expectExactlyOnce(reopened.saveButton);
  await expectExactlyOnce(reopened.saveAndCloseButton);
  await expect(reopened.saveAsDraftButton).toHaveCount(0);
  await expectTools(agent, [
    "SurveyEditorPage.save",
    "SurveyEditorPage.saveAsDraft",
  ]);
  const notADraft = await agent.call("SurveyEditorPage.saveAsDraft");
  expect(notADraft.isError, notADraft.text).toBe(true);
  expect(notADraft.text).toContain(
    "Use SurveyEditorPage.save, or SurveyEditorPage.saveAndClose"
  );
  const publishedName = `Ayme lab published ${surveyId}`;
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
  await page.goto(
    `/workspaces/${user.workspaceId}/surveys/${surveyId}/summary`
  );
  await expectExactlyOnce(surveySummaryPage.editButton);
  await expectHydrated(surveySummaryPage.editButton);
  const dialog = await surveySummaryPage.edit();
  assert(dialog instanceof EditActiveSurveyDialog);
  await expectExactlyOnce(dialog.root);
  await expectExactlyOnce(dialog.editButton);
  await expectExactlyOnce(dialog.duplicateAndEditButton);
  await expectTools(agent, ["EditActiveSurveyDialog.edit"]);
  const editor = await dialog.edit();
  await page.waitForURL(
    new RegExp(`${editorPath(user.workspaceId, surveyId)}$`)
  );
  await expect(editor.surveyNameInput).toHaveValue(publishedName);
});
