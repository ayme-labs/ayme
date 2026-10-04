/**
 * Everything that touches Formbricks's own database package. The package is
 * loaded at run time from the lab app's submodule checkout, never imported,
 * so this file typechecks and lints without the submodule.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import {
  editorPath,
  summaryPath,
  type Mission,
  type MissionDefinition,
} from "../missions.ts";
import type { SurveyRecord } from "../verdict.ts";

type Delegate = {
  create(args: object): Promise<unknown>;
  createMany(args: object): Promise<unknown>;
  findUnique(args: object): Promise<unknown>;
  findMany(args: object): Promise<unknown>;
  findFirstOrThrow(args: object): Promise<unknown>;
};

type Prisma = {
  user: Delegate;
  account: Delegate;
  workspace: Delegate;
  contactAttributeKey: Delegate;
  survey: Delegate;
  authzedProjectionOutbox: Delegate;
  $disconnect(): Promise<void>;
};

export type FormbricksDatabase = {
  prisma: Prisma;
  createId: () => string;
  hashPassword: (password: string) => Promise<string>;
  close: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== "string")
    throw new TypeError(`Formbricks returned no string ${key}`);
  return value[key];
}

/**
 * Builds `@formbricks/database` with its dependencies when the checkout has
 * not been built yet. `lab:prepare` only installs; the package's entry is its
 * build output. Idempotent, and outside the measured window.
 */
export function ensureDatabaseBuilt(
  formbricksRoot: string,
  log: (line: string) => void
) {
  const entry = path.join(formbricksRoot, "packages/database/dist/index.cjs");
  if (existsSync(entry)) return;
  log("Building Formbricks's database package (first run only).");
  const manifest = createRequire(path.join(formbricksRoot, "package.json"))(
    "./package.json"
  ) as { packageManager?: string };
  const packageManager = manifest.packageManager ?? "pnpm";
  const result = spawnSync(
    "corepack",
    [
      packageManager,
      "--dir",
      formbricksRoot,
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@formbricks/database...",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (result.status !== 0 || !existsSync(entry))
    throw new Error(
      `Building @formbricks/database failed:\n${result.stdout}\n${result.stderr}`
    );
}

/** Loads Formbricks's `.env` and its database package from the checkout. */
export async function openFormbricksDatabase(
  formbricksRoot: string
): Promise<FormbricksDatabase> {
  const requireFromFormbricks = createRequire(
    path.join(formbricksRoot, "package.json")
  );
  const dotenv = requireFromFormbricks("dotenv") as {
    config: (options: { path: string; quiet?: boolean }) => unknown;
  };
  dotenv.config({ path: path.join(formbricksRoot, ".env"), quiet: true });
  const requireFromDatabase = createRequire(
    path.join(formbricksRoot, "packages/database/package.json")
  );
  const { prisma } = requireFromDatabase(".") as { prisma: Prisma };
  const { createId } = requireFromFormbricks("@paralleldrive/cuid2") as {
    createId: () => string;
  };
  const bcrypt = requireFromFormbricks("bcryptjs") as {
    hash: (value: string, rounds: number) => Promise<string>;
  };
  return {
    prisma,
    createId,
    // Formbricks verifies credential sign-in against a bcrypt hash of cost 10 to 12.
    hashPassword: (password) => bcrypt.hash(password, 10),
    close: () => prisma.$disconnect(),
  };
}

/**
 * Seeds an isolated user, organization, workspace and survey for one run,
 * following the shapes Formbricks's own seed writes at this revision. Earlier
 * data is never touched.
 */
export async function seedMission(
  database: FormbricksDatabase,
  definition: MissionDefinition,
  runId: string,
  baseUrl: string
): Promise<Mission> {
  const { prisma, createId, hashPassword } = database;
  const name = `eval-${runId}`;
  const email = `${name}@example.com`;
  const password = `Eval-${randomBytes(9).toString("base64url")}`;
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: passwordHash,
      emailVerified: true,
      locale: "en-US",
      memberships: {
        create: {
          role: "owner",
          accepted: true,
          organization: {
            create: {
              name: `Eval organization ${runId}`,
              billing: {
                create: {
                  limits: { workspaces: 3, monthly: { responses: 1500 } },
                  stripeCustomerId: null,
                  usageCycleAnchor: new Date(),
                },
              },
              workspaces: { create: { name: "Eval workspace" } },
            },
          },
        },
      },
    },
    include: { memberships: true },
  });
  const userId = requireString(user, "id");
  const memberships = isRecord(user) ? user.memberships : undefined;
  const organizationId = requireString(
    Array.isArray(memberships) ? memberships[0] : undefined,
    "organizationId"
  );

  // Credential sign-in checks a "credential" account row, keyed the way Better Auth expects.
  await prisma.account.create({
    data: {
      userId,
      type: "credential",
      provider: "credential",
      providerAccountId: userId,
      password: passwordHash,
      issuer: "local:credential",
    },
  });

  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { organizationId },
  });
  const workspaceId = requireString(workspace, "id");
  await prisma.contactAttributeKey.createMany({
    data: [
      {
        name: "Email",
        key: "email",
        isUnique: true,
        type: "default",
        workspaceId,
      },
      {
        name: "First Name",
        key: "firstName",
        isUnique: false,
        type: "default",
        workspaceId,
      },
      {
        name: "Last Name",
        key: "lastName",
        isUnique: false,
        type: "default",
        workspaceId,
      },
      {
        name: "userId",
        key: "userId",
        isUnique: true,
        type: "default",
        workspaceId,
      },
    ],
  });

  // What the agent types carries a short nonce, so typing length does not dominate the measurement.
  const nonce = randomBytes(3).toString("hex");
  const initial = definition.initial(nonce);
  const questionId = createId();
  const survey = await prisma.survey.create({
    data: {
      name: initial.surveyName,
      type: "link",
      // Running, not a draft: the editor then offers Save & Close and closes to the summary.
      status: "inProgress",
      workspaceId,
      createdBy: userId,
      ownerId: userId,
      blocks: [
        {
          id: createId(),
          name: "Main Block",
          elements: [
            {
              id: questionId,
              type: "openText",
              headline: { default: initial.questionHeadline },
              placeholder: { default: "Type your answer here..." },
              required: true,
              inputType: "text",
              charLimit: { enabled: false },
            },
          ],
        },
      ],
    },
  });
  const surveyId = requireString(survey, "id");

  return {
    id: definition.id,
    runId,
    nonce,
    user: { id: userId, name, email, password },
    organizationId,
    workspaceId,
    surveyId,
    questionId,
    initial,
    expected: definition.expected(nonce),
    startUrl: `${baseUrl}${editorPath(workspaceId, surveyId)}`,
    summaryUrl: `${baseUrl}${summaryPath(workspaceId, surveyId)}`,
  };
}

/**
 * Formbricks decides access through SpiceDB, which a background worker fills
 * from Postgres with a lag of seconds. Waits until every outbox row the seed
 * produced is processed, so sign-in does not land on "create organization".
 */
export async function waitForAuthorizationProjection(
  database: FormbricksDatabase,
  mission: Mission,
  options: { timeoutMs: number; pollMs?: number }
): Promise<{ rows: number; waitedMs: number }> {
  const ids = [
    mission.user.id,
    mission.organizationId,
    mission.workspaceId,
    mission.surveyId,
  ];
  const startedAt = Date.now();
  const pollMs = options.pollMs ?? 500;
  for (;;) {
    const rows = await database.prisma.authzedProjectionOutbox.findMany({
      where: { primaryId: { in: ids } },
      select: {
        targetType: true,
        processedAt: true,
        deadLetteredAt: true,
        lastErrorCode: true,
      },
    });
    if (!Array.isArray(rows))
      throw new TypeError("Formbricks returned no outbox rows");
    const records = rows.filter(isRecord);
    const deadLettered = records.filter((row) => row.deadLetteredAt !== null);
    if (deadLettered.length > 0)
      throw new Error(
        `Formbricks dead-lettered the seed's authorization projection: ${deadLettered
          .map(
            (row) => `${String(row.targetType)} (${String(row.lastErrorCode)})`
          )
          .join(", ")}`
      );
    const pending = records.filter((row) => row.processedAt === null);
    if (records.length > 0 && pending.length === 0)
      return { rows: records.length, waitedMs: Date.now() - startedAt };
    if (Date.now() - startedAt > options.timeoutMs)
      throw new Error(
        `Formbricks's authorization projection did not process the seed within ${options.timeoutMs} ms (${pending.length} of ${records.length} rows pending). Is the lab app's worker running?`
      );
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** The read-only query behind the verdict. */
export async function readSurvey(
  database: FormbricksDatabase,
  surveyId: string
): Promise<SurveyRecord> {
  const survey = await database.prisma.survey.findUnique({
    where: { id: surveyId },
    select: { name: true, workspaceId: true, blocks: true },
  });
  if (survey === null) return null;
  return {
    name: requireString(survey, "name"),
    workspaceId: requireString(survey, "workspaceId"),
    blocks: isRecord(survey) ? survey.blocks : undefined,
  };
}
