import { describe, expect, it } from "vitest";

import { arms } from "./arms.ts";
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
});

describe("the playwright-mcp arm", () => {
  it("runs the pinned Playwright MCP server, headless, on the signed-in profile", () => {
    const servers = arms["playwright-mcp"].mcpServers({
      profileDir: "/run/browser-profile",
      outputDir: "/run/playwright-output",
      initPagePath: "/run/init-page.cjs",
    });
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
