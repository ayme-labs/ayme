import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The Formbricks submodule checkout, which `lab:prepare` installs. */
const FORMBRICKS_DIR = fileURLToPath(new URL("../formbricks", import.meta.url));

type Delegate = {
  create(args: object): Promise<unknown>;
  createMany(args: object): Promise<unknown>;
  findMany(args: object): Promise<unknown>;
  findFirstOrThrow(args: object): Promise<unknown>;
};

/** What the seed uses of Formbricks's Prisma client. */
type Prisma = {
  user: Delegate;
  account: Delegate;
  workspace: Delegate;
  survey: Delegate;
  response: Delegate;
  contactAttributeKey: Delegate;
  authzedProjectionOutbox: Delegate;
  $disconnect(): Promise<void>;
};

type Formbricks = {
  prisma: Prisma;
  hashPassword: (password: string) => Promise<string>;
  /** The issuer Better Auth signs a credential account in against. */
  credentialIssuer: string;
};

let loaded: Formbricks | undefined;

/**
 * Formbricks's own database package and what it seeds a user with, loaded at
 * run time from the submodule checkout, never imported, so this file
 * typechecks and lints without the submodule. It reads the database URL from
 * Formbricks's `.env`.
 */
function formbricks(): Formbricks {
  if (loaded) return loaded;
  const database = path.join(FORMBRICKS_DIR, "packages/database");
  if (!existsSync(path.join(database, "dist/index.cjs")))
    throw new Error(
      `Formbricks's database package is not built at ${database}. Start the lab app with pnpm lab:dev, which builds it.`
    );
  // The app's own dependencies, as its code resolves them.
  const requireFromApp = createRequire(
    path.join(FORMBRICKS_DIR, "apps/web/package.json")
  );
  const dotenv = requireFromApp("dotenv") as {
    config(options: { path: string; quiet: boolean }): unknown;
  };
  dotenv.config({ path: path.join(FORMBRICKS_DIR, ".env"), quiet: true });
  const { prisma } = createRequire(path.join(database, "package.json"))(
    "."
  ) as { prisma: Prisma };
  const bcrypt = requireFromApp("bcryptjs") as {
    hash(value: string, rounds: number): Promise<string>;
  };
  const { createLocalAccountIssuer } = requireFromApp(
    "@better-auth/core/db"
  ) as { createLocalAccountIssuer(provider: string): string };
  loaded = {
    prisma,
    hashPassword: (password) => bcrypt.hash(password, 10),
    credentialIssuer: createLocalAccountIssuer("credential"),
  };
  return loaded;
}

export type SeededUser = {
  userId: string;
  email: string;
  password: string;
  organizationId: string;
  workspaceId: string;
};

/**
 * Creates an isolated user with its own organization and workspace, as
 * Formbricks's own Playwright fixture does, and waits until Formbricks has
 * projected them into its authorization store.
 */
export async function seedUser(): Promise<SeededUser> {
  const { prisma, hashPassword, credentialIssuer } = formbricks();
  const name = `ayme-lab-${process.pid}-${Date.now()}`;
  const email = `${name}@example.com`;
  const hashedPassword = await hashPassword(name);

  const user = (await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      emailVerified: true,
      locale: "en-US",
      memberships: {
        create: {
          organization: {
            create: {
              name: "Ayme Lab",
              billing: {
                create: {
                  limits: { workspaces: 3, monthly: { responses: 1500 } },
                  stripeCustomerId: null,
                  usageCycleAnchor: new Date(),
                },
              },
              workspaces: { create: { name: "Ayme Lab Workspace" } },
            },
          },
          role: "owner",
        },
      },
    },
    include: { memberships: true },
  })) as { id: string; memberships: { organizationId: string }[] };

  // Better Auth signs in against a credential account with the local issuer.
  await prisma.account.create({
    data: {
      userId: user.id,
      type: "credential",
      provider: "credential",
      providerAccountId: user.id,
      issuer: credentialIssuer,
      password: hashedPassword,
    },
  });

  const organizationId = user.memberships[0]!.organizationId;
  const workspace = (await prisma.workspace.findFirstOrThrow({
    where: { organizationId },
  })) as { id: string };
  const workspaceId = workspace.id;
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

  await waitForAuthorization([user.id, organizationId, workspaceId]);
  return {
    userId: user.id,
    email,
    password: name,
    organizationId,
    workspaceId,
  };
}

/**
 * Formbricks checks access through its authorization store, which a
 * background worker fills from PostgreSQL a second or more after each write.
 * Waits until every outbox event about these records is delivered; signing in
 * earlier lands on "create organization".
 */
export async function waitForAuthorization(
  ids: string[],
  timeoutMs = 30_000
): Promise<void> {
  const { prisma } = formbricks();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = (await prisma.authzedProjectionOutbox.findMany({
      where: { OR: [{ primaryId: { in: ids } }, { secondaryId: { in: ids } }] },
      select: { targetType: true, processedAt: true, deadLetteredAt: true },
    })) as {
      targetType: string;
      processedAt: Date | null;
      deadLetteredAt: Date | null;
    }[];
    const deadLettered = events.filter((event) => event.deadLetteredAt);
    if (deadLettered.length > 0)
      throw new Error(
        `Formbricks dead-lettered the authorization events for ${deadLettered.map((e) => e.targetType).join(", ")}.`
      );
    const pending = events.filter((event) => !event.processedAt);
    if (events.length > 0 && pending.length === 0) return;
    if (Date.now() > deadline)
      throw new Error(
        `Formbricks did not deliver ${events.length === 0 ? "any" : pending.length} authorization events within ${timeoutMs} ms. Is the app running?`
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** A survey's name and status as Formbricks has stored them. */
export async function storedSurvey(
  surveyId: string
): Promise<{ name: string; status: string }> {
  return (await formbricks().prisma.survey.findFirstOrThrow({
    where: { id: surveyId },
    select: { name: true, status: true },
  })) as { name: string; status: string };
}

/** Gives the survey one finished response. */
export async function seedResponse(surveyId: string): Promise<void> {
  await formbricks().prisma.response.create({
    data: { surveyId, finished: true },
  });
}

/** Closes the database connection, if a test opened one. */
export const disconnect = async () => {
  await loaded?.prisma.$disconnect();
};
