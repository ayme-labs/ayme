import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  armIds,
  arms,
  defaultArmIds,
  type ArmContext,
  type CommandAutomation,
} from "./arms.ts";
import { aymeMcpCliPath } from "./ayme.ts";
import {
  aymeAttachArgs,
  aymeCliDisallowedTools,
  aymeCliEnvironment,
  aymeCliSentence,
  aymeCliShimScript,
  aymeCliSkillDirectory,
  aymeCliSkillSource,
  labPageObjectsEntry,
  markGlobal,
  markOf,
  toolNamesOf,
} from "./aymeCli.ts";
import { parseSuiteOptions } from "./suite.ts";
import { evalRoot, labRoot } from "./paths.ts";
import {
  playwrightCliEnvironment,
  remoteDebuggingConfig,
  remoteDebuggingConfigPath,
} from "./playwrightCli.ts";
import type { Mission } from "./missions.ts";
import { setupPrompt } from "./prompt.ts";

const editorStart: Mission["start"] = {
  screen: "editor",
  url: "http://localhost:3000/workspaces/workspace-1/surveys/survey-1/edit",
  signedIn: true,
};
const signInStart: Mission["start"] = {
  screen: "sign-in",
  url: "http://localhost:3000/auth/login",
  signedIn: false,
};

const cliArmIds = armIds.filter((armId) => arms[armId].aymeCli);

const armContext: ArmContext = {
  runId: "run-abc123",
  runDir: "/run",
  profileDir: "/run/browser-profile",
  outputDir: "/run/playwright-output",
  initPagePath: "/run/init-page.cjs",
  configDir: "/run/claude-config",
  start: editorStart,
  cwd: "/lab",
  log: () => undefined,
};

const skillText = readFileSync(
  path.join(aymeCliSkillSource, "SKILL.md"),
  "utf8"
);

/** The instruction text's section on one browser automation. */
function skillSection(browserAutomation: CommandAutomation) {
  const heading = {
    "playwright-cli": "### Playwright CLI",
    "agent-browser": "### agent-browser",
  }[browserAutomation];
  const start = skillText.indexOf(`${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = skillText.indexOf("\n### ", start + heading.length);
  return skillText.slice(start, end === -1 ? undefined : end);
}

describe("the arms with the ayme command", () => {
  it("are Playwright CLI's and agent-browser's, and a suite runs them only when named", () => {
    expect(cliArmIds).toEqual([
      "playwright-cli-with-ayme-cli",
      "agent-browser-with-ayme-cli",
    ]);
    for (const armId of cliArmIds) {
      expect(armId).toBe(`${arms[armId].browserAutomation}-with-ayme-cli`);
      expect(defaultArmIds).not.toContain(armId);
    }
    expect(parseSuiteOptions(["--arms", cliArmIds.join(",")]).arms).toEqual(
      cliArmIds
    );
  });
});

describe.each(cliArmIds)("the %s arm", (armId) => {
  const arm = arms[armId];
  const alone = arms[arm.browserAutomation];

  it("has its browser automation's interface line and one sentence on where the Page Object Tools are", () => {
    for (const start of [editorStart, signInStart])
      expect(arm.interfaceLine(start)).toBe(
        `Use the \`${arm.browserAutomation}\` command for every browser interaction. Its browser session is already open ${start.signedIn ? "and signed in on the editor" : "on the sign-in page, not signed in"}. ${aymeCliSentence}`
      );
    expect(aymeCliSentence).toContain("start from `ayme tools`");
    expect(aymeCliSentence).toContain("`ayme` command");
    // What to run after a Page Object Tool is the instruction text's alone.
    expect(aymeCliSentence).not.toMatch(
      /page-objects|snapshot|after|read|prefer|right away|next call|skill/i
    );
  });

  it("loads its browser automation's skill and the ayme-cli skill in the setup turn, and reads no file", () => {
    expect(setupPrompt(arm)).toBe(
      `Get ready to work in the web page that is already open in your browser interface; the task follows in the next message. Load the \`${arm.skill}\` skill and the \`ayme-cli\` skill now with the Skill tool. Don't read files and don't use the browser; just reply ready.\n`
    );
  });

  it("adds the ayme command and its skill to its browser automation's permissions, and no MCP server", () => {
    expect(arm.ayme).toBeUndefined();
    expect(arm.mcpServers(armContext)).toEqual({});
    expect(arm.tools).toEqual(alone.tools);
    expect(arm.skill).toBe(alone.skill);
    expect(arm.allowedTools).toEqual([
      ...alone.allowedTools,
      "Bash(ayme:*)",
      "Skill(ayme-cli)",
    ]);
    expect(arm.browserInterface()).toEqual(alone.browserInterface());
  });

  it("keeps its browser automation's denials and denies starting, stopping and the other channel's commands", () => {
    expect(arm.disallowedTools).toEqual([
      ...alone.disallowedTools!,
      ...aymeCliDisallowedTools,
    ]);
    expect(aymeCliDisallowedTools).toEqual(
      expect.arrayContaining([
        "Bash(ayme attach:*)",
        "Bash(ayme detach)",
        "Bash(ayme mcp:*)",
      ])
    );
  });

  it("checks the command's build first, and attaches outside the measured window", () => {
    expect(arm.preconditions?.map((p) => p.name)).toEqual(["Ayme command"]);
    expect(arm.setup).toBeTypeOf("function");
  });

  it("has a section of the instruction text on exposing CDP and setting the mark", () => {
    const section = skillSection(arm.browserAutomation as CommandAutomation);
    expect(section).toContain("**CDP:**");
    expect(section).toContain("**Mark:**");
    expect(section).toContain(`window.${markGlobal} = "<token>"`);
    expect(section).toContain(`\`${arm.browserAutomation} `);
  });
});

describe("the instruction text of the ayme command", () => {
  it("is a skill of this package's spike folder, named ayme-cli, not the shipped skill", () => {
    expect(aymeCliSkillSource).toBe(path.join(evalRoot, "spike/ayme-cli"));
    expect(skillText).toMatch(/^---\nname: ayme-cli\ndescription: .+\n---\n/);
    expect(aymeCliSkillDirectory("/run/claude-config")).toBe(
      "/run/claude-config/skills/ayme-cli"
    );
  });

  it("names every command the agent may run, and the start command the setup runs", () => {
    for (const command of [
      "ayme tools",
      "ayme page-objects",
      "ayme call <tool> '<json parameters>'",
      "ayme attach --cdp <endpoint> --mark <token>",
      "ayme detach",
    ])
      expect(skillText).toContain(`\`${command}\``);
    expect(skillText).toContain(`window.${markGlobal}`);
  });

  it("says what to run after a Page Object Tool and after a navigation", () => {
    expect(skillText).toContain("**After a Page Object Tool:**");
    expect(skillText).toContain("**After a navigation:**");
  });

  it("gives the Playwright CLI the configuration the setup writes", () => {
    expect(remoteDebuggingConfig(9333)).toEqual({
      browser: { launchOptions: { args: ["--remote-debugging-port=9333"] } },
    });
    expect(skillSection("playwright-cli")).toContain(
      '`["--remote-debugging-port=<port>"]`'
    );
    expect(remoteDebuggingConfigPath("/run")).toBe(
      "/run/playwright-cli.config.json"
    );
    const environment = playwrightCliEnvironment(armContext, "/usr/bin", {
      configPath: "/run/playwright-cli.config.json",
    });
    expect(environment.PLAYWRIGHT_MCP_CONFIG).toBe(
      "/run/playwright-cli.config.json"
    );
    // The browser is the CLI's own, as in the arm alone: no endpoint to attach to.
    expect(environment.PLAYWRIGHT_MCP_CDP_ENDPOINT).toBeUndefined();
    expect(environment.PLAYWRIGHT_MCP_BROWSER).toBe("chrome");
    expect(
      playwrightCliEnvironment(armContext, "/usr/bin").PLAYWRIGHT_MCP_CONFIG
    ).toBeUndefined();
  });
});

describe("the ayme command as the harness runs it", () => {
  it("is the workspace's built command behind a one-line executable", () => {
    expect(aymeCliShimScript()).toBe(
      `#!/bin/sh\nexec '${process.execPath}' '${aymeMcpCliPath}' "$@"\n`
    );
  });

  it("keeps its record of the background process in the run folder", () => {
    expect(aymeCliEnvironment({ runDir: "/run" })).toEqual({
      AYME_CACHE_DIR: "/run/ayme-cache",
    });
  });

  it("attaches with the lab app's Page Objects entry, which lies outside the agent's working root", () => {
    expect(labPageObjectsEntry).toBe(
      path.join(labRoot, ".ayme/page-objects.ts")
    );
    expect(existsSync(labPageObjectsEntry)).toBe(true);
    expect(aymeAttachArgs("http://127.0.0.1:9333", "eval-abc123")).toEqual([
      "attach",
      "--cdp",
      "http://127.0.0.1:9333",
      "--mark",
      "eval-abc123",
      "--page-objects",
      labPageObjectsEntry,
    ]);
  });

  it("marks the tab with a token from the run id's random suffix", () => {
    expect(
      markOf("2026-11-17T10-00-00-000Z-agent-browser-with-ayme-cli-abc123")
    ).toBe("eval-abc123");
  });

  it("reads the Page Object Tools' names from what ayme tools prints", () => {
    expect(
      toolNamesOf(
        [
          "SurveyEditorPage.fillSurveyForm: Fill the survey form.",
          '  parameters: {"type":"object","properties":{}}',
          "SurveyEditorPage.saveAndClose",
          '  parameters: {"type":"object"}',
          "",
        ].join("\n")
      )
    ).toEqual([
      "SurveyEditorPage.fillSurveyForm",
      "SurveyEditorPage.saveAndClose",
    ]);
    expect(toolNamesOf("")).toEqual([]);
  });
});
