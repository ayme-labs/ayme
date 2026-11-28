import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  armIds,
  arms,
  aymeSentence,
  type ArmContext,
  type CommandMcpServer,
} from "./arms.ts";
import { aymeReferences, aymeSkillSource } from "./ayme.ts";
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
      surveyName: "Onboarding survey run-1",
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
  openStartPage: () => Promise.resolve("Chrome/1"),
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

  it("names the agent-browser session as signed in on the editor, and as its default one", () => {
    expect(arms["agent-browser"].interfaceLine(mission.start)).toBe(
      "Use the `agent-browser` command for every browser interaction. Its browser session is already open and signed in on the editor; start from `agent-browser snapshot`. It is agent-browser's default session: pass no `--session`."
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

  it.each(armIds.filter((armId) => armId !== "playwright-mcp"))(
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

const aymeArmIds = armIds.filter((armId) => arms[armId].withAyme);
const aloneArmIds = armIds.filter((armId) => !arms[armId].withAyme);

describe("the arms", () => {
  it("are each browser automation alone and with the ayme command", () => {
    expect(armIds.toSorted()).toEqual(
      [
        "playwright-mcp",
        "playwright-mcp-with-ayme",
        "playwright-cli",
        "playwright-cli-with-ayme",
        "agent-browser",
        "agent-browser-with-ayme",
      ].toSorted()
    );
    for (const armId of aymeArmIds)
      expect(armId).toBe(`${arms[armId].browserAutomation}-with-ayme`);
  });

  it("allow every Bash command where the arm has Bash, and no Bash where it has none", () => {
    for (const arm of Object.values(arms))
      expect([arm.id, arm.allowedTools.includes("Bash")]).toEqual([
        arm.id,
        arm.tools.includes("Bash"),
      ]);
    expect(arms["playwright-mcp"].tools).not.toContain("Bash");
  });
});

describe("the interface line of an arm with ayme", () => {
  it("names the ayme command and starts the agent from ayme page-objects, the same for every browser automation", () => {
    expect(aymeSentence).toBe(
      "The `ayme` command lists and calls the Page Object Tools of the screen the browser is on, through a Session already connected to that browser; start from `ayme page-objects`. Run it as `ayme`, which is on the PATH here."
    );
  });

  it("is Playwright MCP's own line and that sentence", () => {
    expect(arms["playwright-mcp-with-ayme"].interfaceLine(mission.start)).toBe(
      `Use the Playwright MCP browser tools (the \`playwright\` MCP server) for every browser interaction. ${aymeSentence}`
    );
  });

  it.each([
    ["playwright-cli-with-ayme", "playwright-cli", ""],
    [
      "agent-browser-with-ayme",
      "agent-browser",
      " It is agent-browser's default session: pass no `--session`.",
    ],
  ] as const)(
    "of %s keeps where its session is and leaves out the start from a snapshot",
    (armId, command, session) => {
      expect(arms[armId].interfaceLine(mission.start)).toBe(
        `Use the \`${command}\` command for every browser interaction. Its browser session is already open and signed in on the editor.${session} ${aymeSentence}`
      );
      expect(arms[armId].interfaceLine(signInMission.start)).toBe(
        `Use the \`${command}\` command for every browser interaction. Its browser session is already open on the sign-in page, not signed in.${session} ${aymeSentence}`
      );
    }
  );

  it.each(aymeArmIds)(
    "of %s carries no rule on when to list the Page Objects, which the skill gives",
    (armId) => {
      const line = arms[armId].interfaceLine(mission.start);
      expect(line).not.toMatch(/each new screen|after|before|prefer|skill/i);
      expect(line).not.toContain("snapshot");
    }
  );
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

  it.each(aymeArmIds)(
    "of %s loads its skills and the ayme skill's references on connecting and on the Page Object Tools",
    (armId) => {
      const arm = arms[armId];
      const skills =
        arm.skill === undefined
          ? "the `ayme` skill"
          : `the \`${arm.skill}\` skill and the \`ayme\` skill`;
      expect(setupPrompt(arm)).toBe(
        `Get ready to work in the web page that is already open in your browser interface; the task follows in the next message. Load ${skills} now with the Skill tool, and read \`references/browser-automation-tools.md\` and \`references/page-tools.md\` in the \`ayme\` skill's folder. Read no other file and don't use the browser; just reply ready.\n`
      );
    }
  );

  it("names references the shipped ayme skill holds and points to", () => {
    expect(aymeReferences).toEqual([
      "references/browser-automation-tools.md",
      "references/page-tools.md",
    ]);
    const skill = readFileSync(path.join(aymeSkillSource, "SKILL.md"), "utf8");
    for (const reference of aymeReferences) {
      expect(existsSync(path.join(aymeSkillSource, reference))).toBe(true);
      expect(skill).toContain(`(${reference})`);
    }
  });

  it("keeps the Playwright CLI arm's setup message as its published runs had it", () => {
    expect(setupPrompt(arms["playwright-cli"])).toBe(
      "Get ready to work in the web page that is already open in your browser interface; the task follows in the next message. Load the `playwright-cli` skill now with the Skill tool. Don't read files and don't use the browser; just reply ready.\n"
    );
    expect(setupPrompt(arms["agent-browser"])).toBe(
      "Get ready to work in the web page that is already open in your browser interface; the task follows in the next message. Load the `agent-browser` skill now with the Skill tool. Don't read files and don't use the browser; just reply ready.\n"
    );
  });

  it("tells Codex to read the skill's file, where Claude Code has a Skill tool", () => {
    expect(setupPrompt(arms["playwright-cli"], "codex")).toContain(
      "Load the `playwright-cli` skill now by reading its `SKILL.md` file. Read no other file and don't use the browser; just reply ready."
    );
    expect(setupPrompt(arms["playwright-cli-with-ayme"], "codex")).toContain(
      "Load the `playwright-cli` skill and the `ayme` skill now by reading their `SKILL.md` files, and read"
    );
    expect(setupPrompt(arms["playwright-mcp-with-ayme"], "codex")).toContain(
      "Load the `ayme` skill now by reading its `SKILL.md` file, and read"
    );
    // An arm without a skill is asked the same of either agent.
    expect(setupPrompt(arms["playwright-mcp"], "codex")).toBe(
      setupPrompt(arms["playwright-mcp"])
    );
  });

  it("tells an arm without a skill not to look for one, and to read no files", () => {
    const prompt = setupPrompt(arms["playwright-mcp"]);
    expect(prompt).toContain("Don't look for a skill.");
    expect(prompt).toContain("Don't read files and don't use the browser");
    expect(prompt.toLowerCase()).not.toContain("playwright");
  });

  it("is not part of the task prompt", () => {
    for (const arm of Object.values(arms))
      expect(createPrompt(mission, arm, baseUrl)).not.toContain(
        setupPrompt(arm).trim()
      );
  });
});

describe.each(aloneArmIds)("the %s arm, without ayme", (armId) => {
  const arm = arms[armId];

  it("gets no ayme command, server, skill, sentence or precondition", () => {
    expect(arm.withAyme).toBe(false);
    expect(Object.keys(arm.mcpServers(armContext))).not.toContain("ayme");
    expect(arm.allowedTools.join(" ")).not.toMatch(/ayme/i);
    expect(arm.skill ?? "").not.toBe("ayme");
    expect(arm.interfaceLine(mission.start)).not.toMatch(/ayme|Page Object/i);
    expect(setupPrompt(arm)).not.toMatch(/ayme/i);
    expect(arm.preconditions ?? []).toEqual([]);
  });
});

describe.each(aymeArmIds)("the %s arm", (armId) => {
  const arm = arms[armId];
  const alone = arms[arm.browserAutomation];

  it("gives the agent no MCP server of ayme's", () => {
    expect(arm.mcpServers(armContext)).toEqual({});
  });

  it("allows the ayme command and the ayme skill beside the browser automation's own, and keeps its interface", () => {
    expect(arm.tools).toEqual(
      expect.arrayContaining([...alone.tools, "Bash", "Skill"])
    );
    expect(arm.allowedTools).toEqual([
      "Bash",
      ...alone.allowedTools.filter((rule) => rule !== "Bash"),
      "Bash(ayme:*)",
      "Skill(ayme)",
    ]);
    expect(arm.skill).toBe(alone.skill);
    expect(arm.browserInterface()).toEqual(alone.browserInterface());
  });

  it("denies the ayme commands that start, end or leave the Session the setup connected, and keeps the automation's denials", () => {
    for (const command of [
      "open",
      "attach",
      "close",
      "detach",
      "inspect",
      "capture",
      "mcp",
    ])
      expect(arm.disallowedTools).toEqual(
        expect.arrayContaining([
          `Bash(ayme ${command})`,
          `Bash(ayme ${command}:*)`,
        ])
      );
    expect(arm.disallowedTools).toEqual(
      expect.arrayContaining(alone.disallowedTools ?? [])
    );
    expect(arm.disallowedTools).not.toContain("Bash(ayme page-objects:*)");
  });

  it("checks the ayme command's build first, and sets the Session up outside the measured window", () => {
    expect(arm.preconditions?.map((p) => p.name)).toEqual(
      expect.arrayContaining(["ayme command"])
    );
    expect(arm.setup).toBeTypeOf("function");
  });
});

describe("the playwright-cli-with-ayme arm", () => {
  it("also checks that the lab app's Playwright has the Chromium ayme open starts", () => {
    expect(
      arms["playwright-cli-with-ayme"].preconditions?.map((p) => p.name)
    ).toEqual(["ayme command", "Chromium for ayme open"]);
    expect(
      arms["agent-browser-with-ayme"].preconditions?.map((p) => p.name)
    ).toEqual(["ayme command"]);
    expect(
      arms["playwright-mcp-with-ayme"].preconditions?.map((p) => p.name)
    ).toEqual(["ayme command"]);
  });
});

describe("the playwright-mcp arm", () => {
  it("runs the pinned Playwright MCP server, headless, on the prepared profile, without the page's WebMCP tools", () => {
    const servers = arms["playwright-mcp"].mcpServers(armContext);
    expect(Object.keys(servers)).toEqual(["playwright"]);
    const playwright = servers.playwright as CommandMcpServer;
    expect(playwright.args).toEqual(
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
    expect(playwright.args[0]).toMatch(/@playwright\/mcp\/cli\.js$/);
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

describe("the playwright-cli arm", () => {
  const arm = arms["playwright-cli"];

  it("names the command, no skill and no MCP server", () => {
    expect(arm.interfaceLine(mission.start)).toContain("`playwright-cli`");
    expect(arm.interfaceLine(mission.start)).not.toContain("skill");
    expect(arm.mcpServers(armContext)).toEqual({});
  });

  it("leaves the agent read-only file tools, the skill and every Bash command", () => {
    expect(arm.tools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "ToolSearch",
      "Bash",
      "Skill",
    ]);
    expect(arm.allowedTools).toEqual([
      "Bash",
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
