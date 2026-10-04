/**
 * Warms the lab app once per suite, before the first run. Turbopack compiles
 * each route on its first visit, which takes seconds; left to the first run
 * it would land inside that run's measured window. This seeds a throwaway
 * mission, signs in and visits the routes the mission touches: the editor,
 * the survey list and the summary page. It only visits; it never starts or
 * restarts the lab app.
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { signInAndOpenEditor } from "./browser.ts";
import {
  openFormbricksDatabase,
  seedMission,
  waitForAuthorizationProjection,
} from "./formbricks/database.ts";
import type { MissionDefinition } from "./missions.ts";

export async function warmLabApp(options: {
  definition: MissionDefinition;
  suiteId: string;
  formbricksRoot: string;
  baseUrl: string;
  /** A folder for the throwaway browser profile; deleted afterwards. */
  workDir: string;
  log: (line: string) => void;
}) {
  const { definition, suiteId, formbricksRoot, baseUrl, workDir, log } =
    options;
  const profileDir = path.join(workDir, "warmup-profile");
  await mkdir(profileDir, { recursive: true });
  const database = await openFormbricksDatabase(formbricksRoot);
  try {
    const mission = await seedMission(
      database,
      definition,
      `${suiteId}-warmup`,
      baseUrl
    );
    await waitForAuthorizationProjection(database, mission, {
      timeoutMs: 60_000,
    });
    await signInAndOpenEditor({
      mission,
      baseUrl,
      profileDir,
      channel: "chrome",
      alsoVisit: [
        `${baseUrl}/workspaces/${mission.workspaceId}/surveys`,
        mission.summaryUrl,
      ],
      log,
    });
  } finally {
    await database.close();
    await rm(profileDir, { recursive: true, force: true });
  }
}
