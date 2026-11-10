/**
 * Warms the lab app once per suite, before the first run. Turbopack compiles
 * each route, and each server action, on its first use, which takes 15 to 25
 * seconds a screen on a fresh dev server; left to the first run it would
 * land inside that run's measured window. This seeds a throwaway
 * user without a survey and walks every screen the missions pass through,
 * by the steps they take: the sign-in page, signed out; then, signed in,
 * the root the sign-in form sends the browser to and the screen where a new
 * organization creates its first survey, from which it starts a survey from
 * scratch to reach the editor; there it saves and closes, which publishes
 * the survey and opens the summary page with its share dialog, closes the
 * dialog, opens the editor again from the summary, and saves and closes
 * once more; then the survey list. The survey it saves is its own.
 * It never starts or restarts the lab app.
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  navigationTimeoutMs,
  openEditor,
  playwright,
  signInThroughApi,
  viewport,
} from "./browser.ts";
import {
  openFormbricksDatabase,
  seededIds,
  seedMission,
  waitForAuthorizationProjection,
} from "./formbricks/database.ts";
import {
  editorPath,
  missionDefinitions,
  newSurveyPath,
  summaryPath,
} from "./missions.ts";

/** The mission whose seed has no survey: the warm-up creates its own, through the app. */
const warmupMissionId = "sign-in-create-and-revise-survey";

export async function warmLabApp(options: {
  suiteId: string;
  formbricksRoot: string;
  baseUrl: string;
  /** A folder for the throwaway browser profile; deleted afterwards. */
  workDir: string;
  log: (line: string) => void;
}) {
  const { suiteId, formbricksRoot, baseUrl, workDir, log } = options;
  const profileDir = path.join(workDir, "warmup-profile");
  await mkdir(profileDir, { recursive: true });
  const database = await openFormbricksDatabase(formbricksRoot);
  try {
    const mission = await seedMission(
      database,
      missionDefinitions[warmupMissionId],
      `${suiteId}-warmup`,
      baseUrl
    );
    await waitForAuthorizationProjection(database, seededIds(mission), {
      timeoutMs: 60_000,
    });
    const context = await playwright().chromium.launchPersistentContext(
      profileDir,
      { channel: "chrome", headless: true, viewport }
    );
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const visit = (url: string) =>
        page.goto(url, { timeout: navigationTimeoutMs });

      await visit(mission.start.url);
      await page
        .getByRole("button", { name: "Log in with Email" })
        .waitFor({ timeout: 60_000 });
      await signInThroughApi(page, baseUrl, mission.user);

      // The sign-in form sends the browser to the root, which redirects to the screen below while
      // the workspace holds no survey; both compile here, and the screen is visited by its own
      // address too, since once the workspace holds a survey it redirects away.
      await visit(`${baseUrl}/`);
      await visit(`${baseUrl}${newSurveyPath(mission.organizationId)}`);
      const startFromScratch = page.getByRole("button", {
        name: "Start from scratch Create your own survey questions",
      });
      await startFromScratch.waitFor({ timeout: 60_000 });
      await startFromScratch.click();
      const editor = new RegExp(
        `${editorPath(mission.workspaceId, "([^/?]+)")}`
      );
      await page.waitForURL(editor, { timeout: navigationTimeoutMs });
      const surveyId = editor.exec(page.url())?.[1];
      if (surveyId === undefined)
        throw new Error(`Starting from scratch landed on ${page.url()}.`);
      await waitForAuthorizationProjection(database, [surveyId], {
        timeoutMs: 60_000,
      });
      await openEditor(page, page.url(), log);

      // The save, the summary it leads to and the way back to the editor compile on their first
      // use too, so the warm-up takes them with its own survey, as the longer mission does.
      const summary = new RegExp(summaryPath(mission.workspaceId, surveyId));
      const saveAndClose = page.getByRole("button", { name: "Save & Close" });
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      await saveAndClose.click();
      await page.waitForURL(summary, { timeout: navigationTimeoutMs });
      // Publishing a survey for the first time opens its share dialog over the summary.
      const closeShareDialog = page.getByRole("button", {
        name: "Close",
        exact: true,
      });
      await closeShareDialog.waitFor({ timeout: 60_000 });
      await closeShareDialog.click();
      await edit.click();
      await page.waitForURL(editor, { timeout: navigationTimeoutMs });
      await saveAndClose.waitFor({ timeout: 60_000 });
      await saveAndClose.click();
      await page.waitForURL(summary, { timeout: navigationTimeoutMs });
      await edit.waitFor({ timeout: 60_000 });

      await visit(`${baseUrl}/workspaces/${mission.workspaceId}/surveys`);
    } finally {
      await context.close();
    }
  } finally {
    await database.close();
    await rm(profileDir, { recursive: true, force: true });
  }
}
