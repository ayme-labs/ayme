import { describe, expect, it } from "vitest";

import { arms, type ArmContext } from "./arms.ts";
import type { Mission } from "./missions.ts";
import { createPrompt } from "./prompt.ts";

const mission: Mission = {
  id: "rename-survey-and-question",
  runId: "run-1",
  nonce: "run-1",
  user: {
    id: "user-1",
    name: "eval-run-1",
    email: "eval-run-1@example.com",
    password: "secret-run-1",
  },
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  surveyId: "survey-1",
  questionId: "question-1",
  initial: {
    surveyName: "Onboarding draft run-1",
    questionHeadline: "What brought you here today? (run-1)",
  },
  expected: {
    surveyName: "Onboarding feedback run-1",
    questionHeadline: "What would make onboarding easier for you? (run-1)",
  },
  startUrl:
    "http://localhost:3000/workspaces/workspace-1/surveys/survey-1/edit",
  summaryUrl:
    "http://localhost:3000/workspaces/workspace-1/surveys/survey-1/summary",
};

const armContext: ArmContext = {
  runId: "run-1",
  runDir: "/run",
  profileDir: "/run/browser-profile",
  outputDir: "/run/playwright-output",
  initPagePath: "/run/init-page.cjs",
  configDir: "/run/claude-config",
  startUrl: mission.startUrl,
  cwd: "/lab",
  log: () => undefined,
};

describe("the prompt", () => {
  const prompt = createPrompt(
    mission,
    arms["playwright-mcp"],
    "http://localhost:3000"
  );

  it("names the arm's interface, the start URL and the expected end state", () => {
    expect(prompt).toContain(arms["playwright-mcp"].interfaceLine);
    expect(prompt).toContain(mission.startUrl);
    expect(prompt).toContain(mission.summaryUrl);
    expect(prompt).toContain("Onboarding feedback run-1");
    expect(prompt).toContain(
      "What would make onboarding easier for you? (run-1)"
    );
  });

  it("never carries the seeded credentials", () => {
    expect(prompt).not.toContain(mission.user.email);
    expect(prompt).not.toContain(mission.user.password);
  });

  it("is the same text for every arm except the interface line", () => {
    for (const arm of Object.values(arms)) {
      const other = createPrompt(mission, arm, "http://localhost:3000");
      expect(other.replace(arm.interfaceLine, "")).toBe(
        prompt.replace(arms["playwright-mcp"].interfaceLine, "")
      );
    }
  });

  it("differs between the Playwright MCP and Playwright CLI arms in that one line alone", () => {
    const mcpLines = prompt.split("\n");
    const cliLines = createPrompt(
      mission,
      arms["playwright-cli"],
      "http://localhost:3000"
    ).split("\n");
    expect(cliLines).toHaveLength(mcpLines.length);
    const differing = mcpLines
      .map((line, index) => ({ mcp: line, cli: cliLines[index] }))
      .filter(({ mcp, cli }) => mcp !== cli);
    expect(differing).toEqual([
      {
        mcp: arms["playwright-mcp"].interfaceLine,
        cli: arms["playwright-cli"].interfaceLine,
      },
    ]);
  });
});

describe("the playwright-mcp arm", () => {
  it("runs the pinned Playwright MCP server, headless, on the signed-in profile", () => {
    const servers = arms["playwright-mcp"].mcpServers(armContext);
    expect(Object.keys(servers)).toEqual(["playwright"]);
    expect(servers.playwright.args).toEqual(
      expect.arrayContaining([
        "--headless",
        "--user-data-dir",
        "/run/browser-profile",
        "--output-dir",
        "/run/playwright-output",
        "--init-page",
        "/run/init-page.cjs",
      ])
    );
    expect(servers.playwright.args[0]).toMatch(/@playwright\/mcp\/cli\.js$/);
    expect(arms["playwright-mcp"].browserInterface()).toEqual({
      name: "@playwright/mcp",
      version: "0.0.83",
    });
  });

  it("leaves the agent only read-only file tools beside its interface", () => {
    expect(arms["playwright-mcp"].tools).toEqual(["Read", "Glob", "Grep"]);
    expect(arms["playwright-mcp"].allowedTools).toEqual(["mcp__playwright"]);
  });
});

describe("the playwright-cli arm", () => {
  const arm = arms["playwright-cli"];

  it("names the command and its skill, and no MCP server", () => {
    expect(arm.interfaceLine).toContain("`playwright-cli`");
    expect(arm.interfaceLine).toContain("skill");
    expect(arm.mcpServers(armContext)).toEqual({});
  });

  it("leaves the agent read-only file tools, the skill and a Bash limited to the CLI", () => {
    expect(arm.tools).toEqual(["Read", "Glob", "Grep", "Bash", "Skill"]);
    expect(arm.allowedTools).toEqual([
      "Bash(playwright-cli *)",
      "Skill(playwright-cli)",
    ]);
  });

  it("denies what the skill would otherwise allow or what leaves the run", () => {
    expect(arm.disallowedTools).toEqual(
      expect.arrayContaining([
        "Bash(npx *)",
        "Bash(playwright-cli kill-all)",
        "Bash(playwright-cli kill-all *)",
        "Bash(playwright-cli install-browser *)",
      ])
    );
  });

  it("is pinned to an exact Playwright CLI version", () => {
    expect(arm.browserInterface()).toEqual({
      name: "@playwright/cli",
      version: "0.1.22",
    });
  });

  it("sets itself up outside the measured window", () => {
    expect(arm.setup).toBeTypeOf("function");
    expect(arms["playwright-mcp"].setup).toBeUndefined();
  });
});
