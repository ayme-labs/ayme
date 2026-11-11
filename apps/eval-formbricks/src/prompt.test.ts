import { describe, expect, it } from "vitest";

import {
  agentBrowserWebMcpToolsSentence,
  arms,
  pageObjectToolsSentence,
  webMcpToolsSentence,
  type ArmContext,
} from "./arms.ts";
import { agentSocketPath } from "./ayme.ts";
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
      "Use the `playwright-cli` command for every browser interaction. Its browser session is already open and signed in on the editor; start from `playwright-cli snapshot`."
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
      "Use the `playwright-cli` command for every browser interaction. Its browser session is already open on the sign-in page, not signed in; start from `playwright-cli snapshot`."
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
    "playwright-mcp-with-ayme-page-objects",
    "playwright-mcp-with-ayme-webmcp",
    "playwright-cli",
    "playwright-cli-with-ayme-page-objects",
    "playwright-cli-with-ayme-webmcp",
    "agent-browser",
    "agent-browser-with-ayme-page-objects",
    "agent-browser-with-ayme-webmcp",
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
  it("name the goal tool in no arm's line", () => {
    for (const arm of Object.values(arms))
      expect(arm.interfaceLine(mission.start)).not.toContain("goal");
  });

  it("of the arm with Ayme's Page Object Tools is the Playwright MCP arm's plus one sentence, and does not depend on the start", () => {
    for (const start of [renameMission.start, signInMission.start]) {
      expect(
        arms["playwright-mcp-with-ayme-page-objects"].interfaceLine(start)
      ).toBe(
        `${arms["playwright-mcp"].interfaceLine(start)} ${pageObjectToolsSentence}`
      );
    }
    expect(
      arms["playwright-mcp-with-ayme-page-objects"].interfaceLine(mission.start)
    ).toBe(
      "Use the Playwright MCP browser tools (the `playwright` MCP server) for every browser interaction. The `ayme` MCP server offers the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step. A Page Object Tool's answer does not show the screen it leads to, so read `page_objects` right after calling one: in the same command where the browser tool is a command, otherwise as a second tool call in the same message. Take a snapshot only when the next step has no Page Object Tool."
    );
  });

  it("of the CLI arm with Ayme's Page Object Tools is the Playwright CLI arm's plus the same sentence, for either start", () => {
    for (const start of [renameMission.start, signInMission.start]) {
      expect(
        arms["playwright-cli-with-ayme-page-objects"].interfaceLine(start)
      ).toBe(
        `${arms["playwright-cli"].interfaceLine(start)} ${pageObjectToolsSentence}`
      );
    }
    expect(
      arms["playwright-cli-with-ayme-page-objects"].interfaceLine(mission.start)
    ).toBe(
      "Use the `playwright-cli` command for every browser interaction. Its browser session is already open and signed in on the editor; start from `playwright-cli snapshot`. The `ayme` MCP server offers the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step. A Page Object Tool's answer does not show the screen it leads to, so read `page_objects` right after calling one: in the same command where the browser tool is a command, otherwise as a second tool call in the same message. Take a snapshot only when the next step has no Page Object Tool."
    );
  });

  it("of the arms with the page's tools through WebMCP are their browser tool's plus one shared sentence that names no server, for either start", () => {
    for (const start of [renameMission.start, signInMission.start]) {
      expect(arms["playwright-mcp-with-ayme-webmcp"].interfaceLine(start)).toBe(
        `${arms["playwright-mcp"].interfaceLine(start)} ${webMcpToolsSentence}`
      );
      expect(arms["playwright-cli-with-ayme-webmcp"].interfaceLine(start)).toBe(
        `${arms["playwright-cli"].interfaceLine(start)} ${webMcpToolsSentence}`
      );
    }
    expect(webMcpToolsSentence).toBe(
      "The page's own tools, which Playwright lists as WebMCP tools, include the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step. A Page Object Tool's answer does not show the screen it leads to, so read `page_objects` right after calling one: in the same command where the browser tool is a command, otherwise as a second tool call in the same message. Take a snapshot only when the next step has no Page Object Tool."
    );
    expect(webMcpToolsSentence).not.toContain("ayme");
    expect(
      arms["playwright-mcp-with-ayme-webmcp"].interfaceLine(mission.start)
    ).toBe(
      "Use the Playwright MCP browser tools (the `playwright` MCP server) for every browser interaction. The page's own tools, which Playwright lists as WebMCP tools, include the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step. A Page Object Tool's answer does not show the screen it leads to, so read `page_objects` right after calling one: in the same command where the browser tool is a command, otherwise as a second tool call in the same message. Take a snapshot only when the next step has no Page Object Tool."
    );
  });

  it("of the agent-browser arms are the Playwright CLI arm's with agent-browser's command, for either start", () => {
    for (const start of [renameMission.start, signInMission.start])
      expect(arms["agent-browser"].interfaceLine(start)).toBe(
        arms["playwright-cli"]
          .interfaceLine(start)
          .replaceAll("playwright-cli", "agent-browser")
      );
    expect(arms["agent-browser"].interfaceLine(mission.start)).toBe(
      "Use the `agent-browser` command for every browser interaction. Its browser session is already open and signed in on the editor; start from `agent-browser snapshot`."
    );
  });

  it("of the agent-browser arm with the page's tools through WebMCP is the baseline's plus one sentence that names its commands and no server, for either start", () => {
    for (const start of [renameMission.start, signInMission.start])
      expect(arms["agent-browser-with-ayme-webmcp"].interfaceLine(start)).toBe(
        `${arms["agent-browser"].interfaceLine(start)} ${agentBrowserWebMcpToolsSentence}`
      );
    expect(agentBrowserWebMcpToolsSentence).toBe(
      "The page's own tools, which `agent-browser webmcp list` lists and `agent-browser webmcp invoke` calls, include the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step. A Page Object Tool's answer does not show the screen it leads to, so read `page_objects` right after calling one: in the same command where the browser tool is a command, otherwise as a second tool call in the same message. Take a snapshot only when the next step has no Page Object Tool."
    );
    expect(agentBrowserWebMcpToolsSentence).not.toContain("ayme");
    expect(agentBrowserWebMcpToolsSentence).not.toContain("Playwright");
    expect(
      agentBrowserWebMcpToolsSentence.replace(/, which .+ calls,/, "")
    ).toBe(webMcpToolsSentence.replace(/, which .+ WebMCP tools,/, ""));
  });

  it("of the agent-browser arm with Ayme's Page Object Tools is the baseline's plus the sentence the other arms with the ayme server add, for either start", () => {
    for (const start of [renameMission.start, signInMission.start])
      expect(
        arms["agent-browser-with-ayme-page-objects"].interfaceLine(start)
      ).toBe(
        `${arms["agent-browser"].interfaceLine(start)} ${pageObjectToolsSentence}`
      );
    expect(
      arms["agent-browser-with-ayme-page-objects"].interfaceLine(mission.start)
    ).toBe(
      "Use the `agent-browser` command for every browser interaction. Its browser session is already open and signed in on the editor; start from `agent-browser snapshot`. The `ayme` MCP server offers the Page Object Tools of the screen the browser is on; prefer one of them whenever it does the step. A Page Object Tool's answer does not show the screen it leads to, so read `page_objects` right after calling one: in the same command where the browser tool is a command, otherwise as a second tool call in the same message. Take a snapshot only when the next step has no Page Object Tool."
    );
  });

  it("of every arm name a browser tool first: no arm runs Ayme without one", () => {
    for (const arm of Object.values(arms))
      expect(arm.interfaceLine(mission.start)).toMatch(
        /^Use the (Playwright MCP browser tools|`playwright-cli` command|`agent-browser` command)/
      );
  });
});

describe("the setup message", () => {
  it("names no app and no task, and keeps the agent off the page", () => {
    for (const arm of Object.values(arms)) {
      const prompt = setupPrompt(arm);
      for (const word of ["Formbricks", "survey", "goal", "localhost", "sign"])
        expect(prompt.toLowerCase()).not.toContain(word.toLowerCase());
      expect(prompt).toContain("don't use the browser; just reply ready.");
    }
  });

  it("names the arm's skill and loads it now", () => {
    expect(setupPrompt(arms["playwright-cli"])).toContain(
      "Load the `playwright-cli` skill now with the Skill tool"
    );
    expect(setupPrompt(arms["agent-browser"])).toContain(
      "Load the `agent-browser` skill now with the Skill tool"
    );
  });

  it("loads the ayme skill in no arm, and has no arm read a skill's references: the arms with Ayme add tools, not a skill", () => {
    for (const arm of Object.values(arms)) {
      expect(arm.skill).not.toBe("ayme");
      expect(arm.readsSkillReferences).toBeUndefined();
      expect(arm.allowedTools).not.toContain("Skill(ayme)");
    }
  });

  it("has a setup turn that reads a skill's references keep to the skill's folder, as the startup lane's does", () => {
    expect(setupPrompt({ skill: "ayme", readsSkillReferences: true })).toBe(
      "Get ready to work in the web page that is already open in your browser interface; the task follows in the next message. Load the `ayme` skill now with the Skill tool and read the references it points you to for this work. Read no file outside that skill's folder and don't use the browser; just reply ready.\n"
    );
  });

  it("keeps the Playwright CLI arm's setup message as its published runs had it, and gives its twin the same", () => {
    expect(setupPrompt(arms["playwright-cli"])).toBe(
      "Get ready to work in the web page that is already open in your browser interface; the task follows in the next message. Load the `playwright-cli` skill now with the Skill tool. Don't read files and don't use the browser; just reply ready.\n"
    );
    expect(setupPrompt(arms["playwright-cli-with-ayme-page-objects"])).toBe(
      setupPrompt(arms["playwright-cli"])
    );
    expect(setupPrompt(arms["playwright-cli-with-ayme-webmcp"])).toBe(
      setupPrompt(arms["playwright-cli"])
    );
  });

  it("gives the agent-browser arms the Playwright CLI arm's setup message, naming their own skill", () => {
    for (const armId of [
      "agent-browser",
      "agent-browser-with-ayme-page-objects",
      "agent-browser-with-ayme-webmcp",
    ] as const)
      expect(setupPrompt(arms[armId])).toBe(
        setupPrompt(arms["playwright-cli"]).replace(
          "`playwright-cli`",
          "`agent-browser`"
        )
      );
  });

  it("tells an arm without a skill not to look for one, and to read no files", () => {
    for (const armId of [
      "playwright-mcp",
      "playwright-mcp-with-ayme-page-objects",
      "playwright-mcp-with-ayme-webmcp",
    ] as const) {
      const prompt = setupPrompt(arms[armId]);
      expect(prompt).toContain("Don't look for a skill.");
      expect(prompt).toContain("Don't read files and don't use the browser");
      expect(prompt.toLowerCase()).not.toContain("playwright");
      expect(prompt.toLowerCase()).not.toContain("ayme");
    }
    expect(setupPrompt(arms["playwright-mcp-with-ayme-page-objects"])).toBe(
      setupPrompt(arms["playwright-mcp"])
    );
    expect(setupPrompt(arms["playwright-mcp-with-ayme-webmcp"])).toBe(
      setupPrompt(arms["playwright-mcp"])
    );
  });

  it("is not part of the task prompt", () => {
    for (const arm of Object.values(arms))
      expect(createPrompt(mission, arm, baseUrl)).not.toContain(
        setupPrompt(arm).trim()
      );
  });
});

describe("the playwright-mcp-with-ayme-page-objects arm", () => {
  const arm = arms["playwright-mcp-with-ayme-page-objects"];

  it("gives the agent Ayme's MCP server through the proxy, and leaves Playwright MCP's entry to its setup, which names the port", () => {
    const servers = arm.mcpServers(armContext);
    expect(Object.keys(servers)).toEqual(["ayme"]);
    expect(servers.ayme).toEqual({
      command: process.execPath,
      args: ["/run/ayme-mcp-proxy.cjs", agentSocketPath("run-1")],
    });
    expect(arm.setup).toBeTypeOf("function");
    expect(arm.browserInterface()).toEqual({
      name: "@playwright/mcp",
      version: "0.0.83",
    });
  });

  it("is the Playwright MCP arm with the ayme server allowed beside Playwright's, no skill and nothing denied", () => {
    const playwrightMcp = arms["playwright-mcp"];
    expect(arm.tools).toEqual(playwrightMcp.tools);
    expect(arm.allowedTools).toEqual(["mcp__playwright", "mcp__ayme"]);
    expect(arm.skill).toBeUndefined();
    expect(arm.readsSkillReferences).toBeUndefined();
    expect(arm.disallowedTools).toBeUndefined();
  });

  it("checks the Ayme server's build and ports", () => {
    expect(arm.preconditions?.map((p) => p.name)).toEqual([
      "Ayme MCP server",
      "Ayme MCP ports",
    ]);
    expect(arm.interfaceLine(mission.start)).not.toContain("goal");
  });
});

describe("the playwright-mcp-with-ayme-webmcp arm", () => {
  const arm = arms["playwright-mcp-with-ayme-webmcp"];
  const playwrightMcp = arms["playwright-mcp"];

  it("gives the agent no MCP server of its own and leaves Playwright MCP's entry to its setup, which names the port", () => {
    expect(arm.mcpServers(armContext)).toEqual({});
    expect(arm.setup).toBeTypeOf("function");
    expect(arm.setup).not.toBe(
      arms["playwright-mcp-with-ayme-page-objects"].setup
    );
    expect(arm.browserInterface()).toEqual(playwrightMcp.browserInterface());
  });

  it("is the Playwright MCP arm in its tools, permissions, skill and denials: the page's tools come through the playwright server", () => {
    expect(arm.tools).toEqual(playwrightMcp.tools);
    expect(arm.allowedTools).toEqual(playwrightMcp.allowedTools);
    expect(arm.allowedTools).not.toContain("mcp__ayme");
    expect(arm.skill).toBeUndefined();
    expect(arm.readsSkillReferences).toBeUndefined();
    expect(arm.disallowedTools).toBeUndefined();
  });

  it("checks the server that serves its page the Page Objects, the WebMCP package the page publishes with, and the ports a page scans", () => {
    expect(arm.preconditions?.map((p) => p.name)).toEqual([
      "Ayme MCP server",
      "Ayme WebMCP package",
      "Ayme MCP ports",
    ]);
    expect(arm.interfaceLine(mission.start)).not.toContain("goal");
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
    expect(arms["playwright-mcp"].tools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "ToolSearch",
    ]);
    expect(arms["playwright-mcp"].allowedTools).toEqual(["mcp__playwright"]);
  });
});

describe("the playwright-cli-with-ayme-page-objects arm", () => {
  const arm = arms["playwright-cli-with-ayme-page-objects"];
  const cli = arms["playwright-cli"];

  it("is the Playwright CLI arm with Ayme's MCP server through the proxy and its permission beside the CLI's", () => {
    const servers = arm.mcpServers(armContext);
    expect(Object.keys(servers)).toEqual(["ayme"]);
    expect(servers.ayme).toEqual(
      arms["playwright-mcp-with-ayme-page-objects"].mcpServers(armContext).ayme
    );
    expect(arm.skill).toBe(cli.skill);
    expect(arm.tools).toEqual(cli.tools);
    expect(arm.allowedTools).toEqual([...cli.allowedTools, "mcp__ayme"]);
    expect(arm.disallowedTools).toEqual(cli.disallowedTools);
    expect(arm.browserInterface()).toEqual(cli.browserInterface());
  });

  it("checks the Ayme server's build and ports, which the CLI arm does not, and sets itself up outside the measured window", () => {
    expect(arm.preconditions?.map((p) => p.name)).toEqual([
      "Ayme MCP server",
      "Ayme MCP ports",
    ]);
    expect(cli.preconditions).toBeUndefined();
    expect(arm.setup).toBeTypeOf("function");
    expect(arm.setup).not.toBe(cli.setup);
  });
});

describe("the playwright-cli-with-ayme-webmcp arm", () => {
  const arm = arms["playwright-cli-with-ayme-webmcp"];
  const cli = arms["playwright-cli"];

  it("is the Playwright CLI arm with no MCP server, the same skill, tools, permissions and denials", () => {
    expect(arm.mcpServers(armContext)).toEqual({});
    expect(arm.skill).toBe(cli.skill);
    expect(arm.tools).toEqual(cli.tools);
    expect(arm.allowedTools).toEqual(cli.allowedTools);
    expect(arm.disallowedTools).toEqual(cli.disallowedTools);
    expect(arm.browserInterface()).toEqual(cli.browserInterface());
  });

  it("checks the server, the WebMCP package and the ports a page scans, which the CLI arm does not, and sets itself up outside the measured window", () => {
    expect(arm.preconditions?.map((p) => p.name)).toEqual([
      "Ayme MCP server",
      "Ayme WebMCP package",
      "Ayme MCP ports",
    ]);
    expect(cli.preconditions).toBeUndefined();
    expect(arm.setup).toBeTypeOf("function");
    expect(arm.setup).not.toBe(cli.setup);
    expect(arm.setup).not.toBe(
      arms["playwright-cli-with-ayme-page-objects"].setup
    );
  });
});

describe.each([
  ["agent-browser", "none"],
  ["agent-browser-with-ayme-page-objects", "server"],
  ["agent-browser-with-ayme-webmcp", "webmcp"],
] as const)("the %s arm", (armId, ayme) => {
  const arm = arms[armId];

  it("gives the agent read-only file tools, its skill and a Bash limited to the command, and the ayme server in the arm with it alone", () => {
    const servers = arm.mcpServers(armContext);
    if (ayme === "server")
      expect(servers).toEqual({
        ayme: arms["playwright-cli-with-ayme-page-objects"].mcpServers(
          armContext
        ).ayme,
      });
    else expect(servers).toEqual({});
    expect(arm.skill).toBe("agent-browser");
    expect(arm.readsSkillReferences).toBeUndefined();
    expect(arm.tools).toEqual(arms["playwright-cli"].tools);
    expect(arm.allowedTools).toEqual([
      "Bash(agent-browser:*)",
      "Skill(agent-browser)",
      ...(ayme === "server" ? ["mcp__ayme"] : []),
    ]);
    expect(arm.interfaceLine(mission.start)).not.toContain("skill");
    expect(arm.interfaceLine(mission.start)).not.toContain("goal");
  });

  it("denies npx and what downloads, reinstalls or closes other runs' sessions, and the webmcp commands in every arm but the one through WebMCP", () => {
    expect(arm.disallowedTools).toEqual(
      expect.arrayContaining([
        "Bash(npx:*)",
        "Bash(agent-browser install)",
        "Bash(agent-browser install:*)",
        "Bash(agent-browser upgrade:*)",
        "Bash(agent-browser doctor --fix:*)",
        "Bash(agent-browser close --all:*)",
      ])
    );
    expect(arm.disallowedTools?.includes("Bash(agent-browser webmcp:*)")).toBe(
      ayme !== "webmcp"
    );
  });

  it("checks what the served Page Objects need in the arms with them alone, sets itself up outside the measured window and records the pinned agent-browser", () => {
    expect(arm.preconditions?.map((p) => p.name)).toEqual(
      {
        none: undefined,
        server: ["Ayme MCP server", "Ayme MCP ports"],
        webmcp: ["Ayme MCP server", "Ayme WebMCP package", "Ayme MCP ports"],
      }[ayme]
    );
    expect(arm.setup).toBeTypeOf("function");
    const setups = [
      "agent-browser",
      "agent-browser-with-ayme-page-objects",
      "agent-browser-with-ayme-webmcp",
    ].map((id) => arms[id as typeof armId].setup);
    expect(new Set(setups).size).toBe(3);
    expect(arm.browserInterface()).toEqual({
      name: "agent-browser",
      version: "0.41.2",
    });
  });
});

describe("the playwright-cli arm", () => {
  const arm = arms["playwright-cli"];

  it("names the command, no skill and no MCP server", () => {
    expect(arm.interfaceLine(mission.start)).toContain("`playwright-cli`");
    expect(arm.interfaceLine(mission.start)).not.toContain("skill");
    expect(arm.mcpServers(armContext)).toEqual({});
  });

  it("leaves the agent read-only file tools, the skill and a Bash limited to the CLI", () => {
    expect(arm.tools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "ToolSearch",
      "Bash",
      "Skill",
    ]);
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
