/**
 * Warms the lab app once per suite, before the first run. Turbopack compiles
 * each route on its first visit, which takes seconds; left to the first run
 * it would land inside that run's measured window. This seeds a throwaway
 * user without a survey and walks the screens the missions touch: the
 * sign-in page, signed out; then, signed in, the root the sign-in form sends
 * the browser to and the screen where a new organization creates its first
 * survey, from which it starts a survey from scratch to reach the editor;
 * then the survey list and the summary page.
 * It only visits; it never starts or restarts the lab app.
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

      await visit(`${baseUrl}/workspaces/${mission.workspaceId}/surveys`);
      await visit(`${baseUrl}${summaryPath(mission.workspaceId, surveyId)}`);
    } finally {
      await context.close();
    }
  } finally {
    await database.close();
    await rm(profileDir, { recursive: true, force: true });
  }
}
