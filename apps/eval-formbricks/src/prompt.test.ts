import { describe, expect, it } from "vitest";

import { arms, goalFirstSentence, type ArmContext } from "./arms.ts";
import { agentSocketPath, aymeMcpVersion } from "./ayme.ts";
import { firstQuestionHeadline, type Mission } from "./missions.ts";
import { createPrompt, setupPrompt } from "./prompt.ts";

const baseUrl = "http://localhost:3000";

/** The default mission, seeded: the agent starts signed in on the editor. */
export const renameMission: Mission = {
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
  survey: {
    id: "survey-1",
    questionId: "question-1",
    initial: {
      surveyName: "Onboarding draft run-1",
      questionHeadline: "What brought you here today? (run-1)",
    },
    editorUrl: `${baseUrl}/workspaces/workspace-1/surveys/survey-1/edit`,
    summaryUrl: `${baseUrl}/workspaces/workspace-1/surveys/survey-1/summary`,
  },
  expected: {
    surveyName: "Onboarding feedback run-1",
    questionHeadline: "What would make onboarding easier for you? (run-1)",
  },
  start: {
    screen: "editor",
    url: `${baseUrl}/workspaces/workspace-1/surveys/survey-1/edit`,
    signedIn: true,
  },
};

/** The second mission, seeded: no survey, and the agent starts signed out on the sign-in page. */
export const signInMission: Mission = {
  id: "sign-in-create-and-revise-survey",
  runId: "run-2",
  nonce: "ab12cd",
  user: {
    id: "user-2",
    name: "eval-run-2",
    email: "eval-run-2@example.com",
    password: "secret-run-2",
  },
  organizationId: "organization-2",
  workspaceId: "workspace-2",
  survey: null,
  expected: {
    surveyName: "Product feedback ab12cd",
    questionHeadline: "What almost stopped you from signing up? (ab12cd)",
  },
  start: { screen: "sign-in", url: `${baseUrl}/auth/login`, signedIn: false },
};

const mission = renameMission;

/** The default mission's prompt for the Playwright MCP arm, as the published numbers were measured with it. */
const defaultMissionPrompt = `Complete the following task in the Formbricks application running at http://localhost:3000.

Use the Playwright MCP browser tools (the \`playwright\` MCP server) for every browser interaction.
Do not use any other browser interface, and do not change anything through the terminal, the Formbricks API or its database.

A browser is already signed in and open on the survey editor at:
http://localhost:3000/workspaces/workspace-1/surveys/survey-1/edit

1. Change the survey's name to: Onboarding feedback run-1
2. Change the headline of its question to: What would make onboarding easier for you? (run-1)
3. Save and close the survey.
4. Confirm that the survey summary page at http://localhost:3000/workspaces/workspace-1/surveys/survey-1/summary shows the new name.

After every browser interaction, check the resulting page state and confirm that the expected effect occurred before continuing. Investigate and recover when it did not. If the browser interface itself fails to start or reports an environment error, stop and report the exact tool and error instead of working around it.

The working directory holds the Formbricks source for reference. Treat it as read-only: make every change through the running application, and do not start, stop or reconfigure the application.

Finish only after the summary page shows the new survey name. Report the final URL and the evidence that convinced you the task succeeded.
`;

const armContext: ArmContext = {
  runId: "run-1",
  runDir: "/run",
  profileDir: "/run/browser-profile",
  outputDir: "/run/playwright-output",
  initPagePath: "/run/init-page.cjs",
  configDir: "/run/claude-config",
  start: mission.start,
  cwd: "/lab",
  log: () => undefined,
};

describe("the prompt of the default mission", () => {
  const prompt = createPrompt(mission, arms["playwright-mcp"], baseUrl);

  it("is the text the published numbers were measured with", () => {
    expect(prompt).toBe(defaultMissionPrompt);
  });

  it("names the Playwright CLI session as signed in on the editor", () => {
    expect(arms["playwright-cli"].interfaceLine(mission.start)).toBe(
      "Use the `playwright-cli` command and its `playwright-cli` skill for every browser interaction. Its browser session is already open and signed in on the editor; start from `playwright-cli snapshot`."
    );
  });

  it("never carries the seeded credentials", () => {
    expect(prompt).not.toContain(mission.user.email);
    expect(prompt).not.toContain(mission.user.password);
  });
});

describe("the prompt of the sign-in mission", () => {
  const prompt = createPrompt(signInMission, arms["playwright-mcp"], baseUrl);

  it("starts on the sign-in page, signed out, and carries the seeded credentials", () => {
    expect(prompt).toContain(
      "A browser is open on the sign-in page, not signed in, at:\nhttp://localhost:3000/auth/login\n"
    );
    expect(prompt).toContain(
      "1. Sign in with the email eval-run-2@example.com and the password secret-run-2\n"
    );
  });

  it("creates, names and revises the survey with the nonce in every typed value", () => {
    expect(prompt).toContain(`2. Create a new survey from scratch.
3. Change the survey's name to: Product feedback ab12cd
4. Change the headline of its question to: How did you hear about us? (ab12cd)
5. Save and close the survey.
6. Close the share dialog that opens on the survey summary page.
7. Open the survey in the survey editor again.
8. Change the headline of its question to: What almost stopped you from signing up? (ab12cd)
9. Save and close the survey.
10. Confirm that the survey summary page shows the survey's name.
`);
    expect(firstQuestionHeadline("ab12cd")).toBe(
      "How did you hear about us? (ab12cd)"
    );
    expect(prompt).toContain(
      "Finish only after the summary page shows the survey's name. Report the final URL"
    );
  });

  it("keeps the shared text of the default mission around the mission's own lines", () => {
    const sharedParagraphs = (text: string) =>
      text.split("\n\n").filter((_, index) => ![2, 3, 6].includes(index));
    expect(sharedParagraphs(prompt)).toEqual(
      sharedParagraphs(defaultMissionPrompt)
    );
  });

  it("names the Playwright CLI session as open on the sign-in page, signed out", () => {
    expect(arms["playwright-cli"].interfaceLine(signInMission.start)).toBe(
      "Use the `playwright-cli` command and its `playwright-cli` skill for every browser interaction. Its browser session is already open on the sign-in page, not signed in; start from `playwright-cli snapshot`."
    );
  });

  it("rejects a mission the definitions do not know", () => {
    expect(() =>
      createPrompt(
        { ...signInMission, id: "nope" },
        arms["playwright-mcp"],
        baseUrl
      )
    ).toThrow("Unknown mission nope");
  });
});

describe.each([
  ["the default mission", renameMission],
  ["the sign-in mission", signInMission],
])("the prompt of %s across arms", (_, seeded) => {
  const prompt = createPrompt(seeded, arms["playwright-mcp"], baseUrl);

  it("names the arm's interface, the start URL and the expected end state", () => {
    expect(prompt).toContain(
      arms["playwright-mcp"].interfaceLine(seeded.start)
    );
    expect(prompt).toContain(seeded.start.url);
    expect(prompt).toContain(seeded.expected.surveyName);
    expect(prompt).toContain(seeded.expected.questionHeadline);
  });

  it("is the same text for every arm except the interface line", () => {
    for (const arm of Object.values(arms)) {
      const other = createPrompt(seeded, arm, baseUrl);
      expect(other.replace(arm.interfaceLine(seeded.start), "")).toBe(
        prompt.replace(arms["playwright-mcp"].interfaceLine(seeded.start), "")
      );
    }
  });

  it.each([
    "playwright-cli",
    "ayme-goal-loop-off",
    "ayme-goal-loop-on",
  ] as const)(
    "differs between the Playwright MCP arm and %s in that one line alone",
    (armId) => {
      const mcpLines = prompt.split("\n");
      const otherLines = createPrompt(seeded, arms[armId], baseUrl).split("\n");
      expect(otherLines).toHaveLength(mcpLines.length);
      const differing = mcpLines
        .map((line, index) => ({ mcp: line, other: otherLines[index] }))
        .filter(({ mcp, other }) => mcp !== other);
      expect(differing).toEqual([
        {
          mcp: arms["playwright-mcp"].interfaceLine(seeded.start),
          other: arms[armId].interfaceLine(seeded.start),
        },
      ]);
    }
  );
});

describe("the interface lines", () => {
  it("name the goal tool only in the Goal Loop on arm's line", () => {
    const on = arms["ayme-goal-loop-on"].interfaceLine(mission.start);
    expect(on).toContain("`goal`");
    expect(on).toContain("Hand the goal to the `goal` tool first");
    expect(
      arms["ayme-goal-loop-off"].interfaceLine(mission.start)
    ).not.toContain("goal");
  });

  it("of the Ayme arms differ in the goal-first sentence alone, and do not depend on the start", () => {
    for (const start of [renameMission.start, signInMission.start]) {
      expect(arms["ayme-goal-loop-on"].interfaceLine(start)).toBe(
        `${arms["ayme-goal-loop-off"].interfaceLine(start)} ${goalFirstSentence}`
      );
      expect(arms["ayme-goal-loop-off"].interfaceLine(start)).toBe(
        arms["ayme-goal-loop-off"].interfaceLine(renameMission.start)
      );
    }
    expect(goalFirstSentence).toBe(
      "Hand the goal to the `goal` tool first; use the other tools only if it can't finish."
    );
  });
});

describe("the setup message", () => {
  it("names no app, no task and no arm, and keeps the agent off the page", () => {
    for (const word of [
      "Formbricks",
      "survey",
      "ayme",
      "playwright",
      "goal",
      "localhost",
      "sign",
    ])
      expect(setupPrompt.toLowerCase()).not.toContain(word.toLowerCase());
    expect(setupPrompt).toContain("Don't read files and don't use the browser");
    expect(setupPrompt).toContain(
      "If a skill for your browser interface is in your skill list, load it."
    );
    expect(setupPrompt).toContain("Otherwise don't look for one.");
  });

  it("is not part of the task prompt", () => {
    expect(
      createPrompt(mission, arms["playwright-mcp"], baseUrl)
    ).not.toContain(setupPrompt.trim());
  });
});

describe.each([
  ["ayme-goal-loop-off", false],
  ["ayme-goal-loop-on", true],
] as const)("the %s arm", (armId, goalLoop) => {
  const arm = arms[armId];

  it("gives the agent Ayme's MCP server, through the proxy to the one the setup starts, and no Playwright interface", () => {
    const servers = arm.mcpServers(armContext);
    expect(Object.keys(servers)).toEqual(["ayme"]);
    expect(servers.ayme.command).toBe(process.execPath);
    expect(servers.ayme.args).toEqual([
      "/run/ayme-mcp-proxy.cjs",
      agentSocketPath("run-1"),
    ]);
    expect(arm.browserInterface()).toEqual({
      name: "@ayme-dev/mcp",
      version: aymeMcpVersion(),
    });
  });

  it("leaves the agent read-only file tools, the server's tools and the eval's ayme skill, with nothing denied", () => {
    expect(arm.tools).toEqual(["Read", "Glob", "Grep", "Skill"]);
    expect(arm.allowedTools).toEqual(["mcp__ayme", "Skill(ayme)"]);
    expect(arm.disallowedTools).toBeUndefined();
    expect(arm.interfaceLine(mission.start)).toContain("its `ayme` skill");
  });

  it("checks the server's build and ports first, and sets the server and the page up outside the measured window", () => {
    expect(arm.preconditions?.map((p) => p.name)).toEqual([
      "Ayme MCP server",
      "Ayme MCP ports",
    ]);
    expect(arm.setup).toBeTypeOf("function");
    expect(arm.interfaceLine(mission.start).includes("`goal`")).toBe(goalLoop);
  });
});

describe("the playwright-mcp arm", () => {
  it("runs the pinned Playwright MCP server, headless, on the prepared profile, without the page's WebMCP tools", () => {
    const servers = arms["playwright-mcp"].mcpServers(armContext);
    expect(Object.keys(servers)).toEqual(["playwright"]);
    expect(servers.playwright.args).toEqual(
      expect.arrayContaining([
        "--headless",
        "--no-webmcp",
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
    expect(arm.interfaceLine(mission.start)).toContain("`playwright-cli`");
    expect(arm.interfaceLine(mission.start)).toContain("skill");
    expect(arm.mcpServers(armContext)).toEqual({});
  });

  it("leaves the agent read-only file tools, the skill and a Bash limited to the CLI", () => {
    expect(arm.tools).toEqual(["Read", "Glob", "Grep", "Bash", "Skill"]);
    expect(arm.allowedTools).toEqual([
      "Bash(playwright-cli:*)",
      "Skill(playwright-cli)",
    ]);
  });

  it("denies what the skill would otherwise allow or what leaves the run", () => {
    expect(arm.disallowedTools).toEqual(
      expect.arrayContaining([
        "Bash(npx:*)",
        "Bash(playwright-cli kill-all)",
        "Bash(playwright-cli kill-all:*)",
        "Bash(playwright-cli install-browser:*)",
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
