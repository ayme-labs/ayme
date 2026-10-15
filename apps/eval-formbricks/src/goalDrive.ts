/**
 * Research tooling for "one Jev decision per Goal Loop step" (ayme#595). Drives
 * a mission through the `goal` tool alone, with no coding agent: the same
 * seed, start page, Ayme MCP server and pairing as the `ayme-goal-loop-on`
 * arm, then one `goal` call per screen, scripted below, over the server's
 * MCP connection. Each run folder gets the arm's `decisions.jsonl`, the
 * Handovers and the database verdict. Needs the lab app with its model key,
 * but no Claude Code token. Run by hand only.
 *
 *   node src/goalDrive.ts [--mission <id>] [--runs N]
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { arms, type ArmContext } from "./arms.ts";
import { agentSocketPath } from "./ayme.ts";
import { openStartPage } from "./browser.ts";
import {
  openFormbricksDatabase,
  readWorkspaceSurveys,
  seededIds,
  seedMission,
  waitForAuthorizationProjection,
} from "./formbricks/database.ts";
import {
  defaultMissionId,
  firstQuestionHeadline,
  missionDefinitions,
  type Mission,
} from "./missions.ts";
import { formbricksRoot, labUrl, resultsRoot } from "./paths.ts";
import {
  checkPreconditions,
  dockerPrecondition,
  formbricksPreparedPrecondition,
  labAppPrecondition,
} from "./preconditions.ts";
import { judgeMission } from "./verdict.ts";

type GoalCall = {
  goal: string;
  maxSteps: number;
  values?: Record<string, string>;
};

/** One goal per screen, as an agent that hands the loop one screen at a time would. */
export function goalScript(mission: Mission): GoalCall[] {
  const edit = (headline: string): GoalCall => ({
    goal: "Change the survey's name and the headline of its question, then save and close the survey.",
    maxSteps: 8,
    values: {
      "survey name": mission.expected.surveyName,
      "question headline": headline,
    },
  });
  if (mission.id === "rename-survey-and-question")
    return [edit(mission.expected.questionHeadline)];
  return [
    {
      goal: "Sign in with the email and password.",
      maxSteps: 6,
      values: { email: mission.user.email, password: mission.user.password },
    },
    { goal: "Create a new survey from scratch.", maxSteps: 6 },
    edit(firstQuestionHeadline(mission.nonce)),
    {
      goal: "Close the share dialog, then open the survey in the survey editor again.",
      maxSteps: 6,
    },
    {
      goal: "Change the headline of its question, then save and close the survey.",
      maxSteps: 6,
      values: { "question headline": mission.expected.questionHeadline },
    },
  ];
}

/** A minimal MCP client over the harness's socket: newline-delimited JSON-RPC. */
class McpClient {
  private nextId = 1;
  private buffer = "";
  private readonly waiting = new Map<number, (message: unknown) => void>();
  private readonly socket: net.Socket;
  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("data", (chunk) => {
      this.buffer += String(chunk);
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number };
        if (typeof message.id === "number")
          this.waiting.get(message.id)?.(message);
      }
    });
  }

  static async connect(socketPath: string): Promise<McpClient> {
    const socket = net.connect(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const client = new McpClient(socket);
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "goal-drive", version: "0.0.0" },
    });
    client.notify("notifications/initialized");
    return client;
  }

  notify(method: string) {
    this.socket.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  request(method: string, params: object, timeoutMs = 60_000) {
    const id = this.nextId++;
    return new Promise<{ result?: Record<string, unknown>; error?: unknown }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${method} timed out`)),
          timeoutMs
        );
        this.waiting.set(id, (message) => {
          clearTimeout(timer);
          this.waiting.delete(id);
          resolve(message as { result?: Record<string, unknown> });
        });
        this.socket.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`
        );
      }
    );
  }

  async toolNames(): Promise<string[]> {
    const { result } = await this.request("tools/list", {});
    return ((result?.tools as { name: string }[] | undefined) ?? []).map(
      (tool) => tool.name
    );
  }

  close() {
    this.socket.destroy();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the screen the tab is on publishes `goal` again, after a page load. */
async function waitForGoal(client: McpClient) {
  await sleep(3_000);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(2_000);
    const names = await client.toolNames().catch((): string[] => []);
    if (names.includes("goal")) return;
  }
  throw new Error("The page did not publish goal again within 90 s.");
}

const log = (line: string) =>
  process.stderr.write(`[${new Date().toISOString()}] ${line}\n`);

async function driveOnce(missionId: string) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-goal-drive-${randomBytes(3).toString("hex")}`;
  const runDir = path.join(resultsRoot, "drives", runId);
  const profileDir = path.join(runDir, "browser-profile");
  await mkdir(profileDir, { recursive: true });
  const arm = arms["ayme-goal-loop-on"];
  await checkPreconditions([
    dockerPrecondition,
    labAppPrecondition(labUrl),
    formbricksPreparedPrecondition(formbricksRoot),
    ...(arm.preconditions ?? []),
  ]);

  const database = await openFormbricksDatabase(formbricksRoot);
  const mission = await seedMission(
    database,
    missionDefinitions[missionId]!,
    runId,
    labUrl
  );
  await writeFile(
    path.join(runDir, "mission.json"),
    `${JSON.stringify(mission, null, 2)}\n`
  );
  await waitForAuthorizationProjection(database, seededIds(mission), {
    timeoutMs: 60_000,
  });
  await openStartPage({
    mission,
    baseUrl: labUrl,
    profileDir,
    channel: "chrome",
    log,
  });

  const context: ArmContext = {
    runId,
    runDir,
    profileDir,
    outputDir: path.join(runDir, "output"),
    initPagePath: path.join(runDir, "init-page.cjs"),
    configDir: path.join(runDir, "config"),
    start: mission.start,
    cwd: runDir,
    log,
  };
  const setup = await arm.setup!(context);
  const handovers: unknown[] = [];
  try {
    const client = await McpClient.connect(agentSocketPath(runId));
    for (const call of goalScript(mission)) {
      log(`goal: ${call.goal}`);
      const started = Date.now();
      const { result, error } = await client.request(
        "tools/call",
        { name: "goal", arguments: call },
        320_000
      );
      const text = (result?.content as { text?: string }[] | undefined)?.[0]
        ?.text;
      let handover: unknown = text ?? error ?? null;
      try {
        handover = text ? JSON.parse(text) : handover;
      } catch {
        // kept as text
      }
      handovers.push({ call, ms: Date.now() - started, handover });
      const reason = (handover as { reason?: string } | null)?.reason;
      log(`handover: ${reason ?? JSON.stringify(handover).slice(0, 200)}`);
      if (reason === "page_loading") await waitForGoal(client);
      else await sleep(1_500);
    }
    client.close();
  } finally {
    await setup.dispose();
  }
  const verdict = judgeMission(
    mission,
    await readWorkspaceSurveys(database, mission.workspaceId)
  );
  await writeFile(
    path.join(runDir, "handovers.json"),
    `${JSON.stringify(handovers, null, 2)}\n`
  );
  await writeFile(
    path.join(runDir, "verdict.json"),
    `${JSON.stringify(verdict, null, 2)}\n`
  );
  log(`Run ${runDir}: ${JSON.stringify(verdict).slice(0, 300)}`);
  return runDir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let missionId = defaultMissionId;
  let runs = 3;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mission") missionId = args[++i]!;
    else if (args[i] === "--runs") runs = Number(args[++i]);
  }
  if (!(missionId in missionDefinitions) || !Number.isInteger(runs)) {
    console.error("Usage: node src/goalDrive.ts [--mission <id>] [--runs N]");
    process.exit(1);
  }
  const dirs: string[] = [];
  for (let run = 1; run <= runs; run++) dirs.push(await driveOnce(missionId));
  console.log(dirs.join("\n"));
  process.exit(0);
}
