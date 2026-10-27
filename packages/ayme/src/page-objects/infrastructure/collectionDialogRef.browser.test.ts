import { afterEach, expect, it, vi } from "vitest";
import type { Locator } from "@playwright/test";

import { createPage } from "./browserPage";
import { probeRegisteredPomMembers, registerCompiledPom } from "./registry";
import { ayme } from "../domain/decorators";
import { callers, type PomManifest } from "../../shared";
import {
  ayme as agent,
  rootRef,
} from "../../test-utils/agentCalls.testSupport";
import { RootedComponent } from "../../test-utils/pomRoot.testSupport";
import { startSession } from "../../test-utils/session.testSupport";
import { geometryReach } from "../../page-state";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function projectsFixture(rootedDialog: boolean) {
  const names = [
    "Website",
    "Mobile app",
    "API",
    "Documentation",
    "Billing migration",
  ];
  document.body.innerHTML = `
    <ul>${names
      .map(
        (name, index) =>
          `<li id="project-${index}"><span>${name}</span><button>Rename</button></li>`
      )
      .join("")}</ul>
    <div role="dialog" aria-label="Rename project" hidden>
      <label>Name<input></label><button>Confirm</button>
    </div>
    <p role="status"></p>
  `;
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const input = dialog.querySelector("input")!;
  let openProject: Element;
  for (const row of document.querySelectorAll("li")) {
    row.querySelector("button")!.onclick = () => {
      openProject = row;
      input.value = row.querySelector("span")!.textContent!;
      dialog.hidden = false;
    };
  }
  dialog.querySelector("button")!.onclick = () => {
    const name = openProject.querySelector("span")!;
    document.querySelector('[role="status"]')!.textContent =
      `Renamed ${name.textContent} to ${input.value}`;
    name.textContent = input.value;
    dialog.hidden = true;
  };

  const page = createPage();
  const session = startSession(page);
  class RenameDialog {
    constructor(readonly root: Locator) {}
    async confirm(name: string) {
      await this.root.getByRole("textbox", { name: "Name" }).fill(name);
      await this.root.getByRole("button", { name: "Confirm" }).click();
    }
  }
  if (rootedDialog)
    ayme({ root: (self: RenameDialog) => self.root })(RenameDialog);
  class ProjectRow extends RootedComponent {
    readonly renameDialog = new RenameDialog(
      this.root.page().getByRole("dialog", { name: "Rename project" })
    );
    async openRename() {
      await this.root.getByRole("button", { name: "Rename" }).click();
      return this.renameDialog;
    }
  }
  class ProjectsPage {
    projects() {
      return names.map(
        (_, index) => new ProjectRow(page.locator(`#project-${index}`))
      );
    }
  }
  const renameDialog: PomManifest = {
    className: "RenameDialog",
    members: [],
    components: [],
    tools: [
      {
        methodName: "confirm",
        toolName: "RenameDialog.confirm",
        parameters: [
          { name: "name", optional: false, schema: { type: "string" } },
        ],
      },
    ],
  };
  const projectRow: PomManifest = {
    className: "ProjectRow",
    members: [
      {
        memberName: "renameDialog",
        kind: "component",
        access: "field",
        componentClassName: "RenameDialog",
        collection: false,
      },
    ],
    components: [renameDialog],
    tools: [
      {
        methodName: "openRename",
        toolName: "ProjectRow.openRename",
        parameters: [],
        returnPoms: ["RenameDialog"],
      },
    ],
  };
  registerCompiledPom(RenameDialog, renameDialog);
  registerCompiledPom(ProjectRow, projectRow);
  registerCompiledPom(ProjectsPage, {
    className: "ProjectsPage",
    members: [
      {
        memberName: "projects",
        kind: "component",
        access: "method",
        componentClassName: "ProjectRow",
        collection: true,
      },
    ],
    components: [projectRow, renameDialog],
    tools: [],
  });
  return { page, session, ProjectsPage };
}

it("#966 targets a shared portaled collection child's own root and refuses a row ref", async () => {
  const { page, session, ProjectsPage } = projectsFixture(true);
  const call = (name: string, input: Record<string, unknown>) =>
    session.ayme.tools.run(name, input, { by: callers.webmcp });
  try {
    session.register(ProjectsPage);
    await probeRegisteredPomMembers();
    const mobileRef = await rootRef("ProjectsPage.projects[1]");
    const billingRef = await rootRef("ProjectsPage.projects[4]");
    await call("ProjectRow.openRename", { ref: mobileRef });
    await probeRegisteredPomMembers();

    expect(
      session.ayme.tools
        .list()
        .filter(({ group }) => group === "pageObject")
        .map(({ name }) => name)
        .sort()
    ).toEqual(["ProjectRow.openRename", "RenameDialog.confirm"]);
    const state = await agent.getPageState();
    const dialogRef = state.text.match(
      /(e\d+) RenameDialog "Rename project":/
    )?.[1];
    expect(dialogRef, state.text).toBeDefined();
    expect(state.text.match(/RenameDialog/g)).toHaveLength(1);
    expect(state.text).not.toContain("renameDialog");

    // Five separate children resolve to one dialog instance.
    const { buildToolOptions } = await import("../../goal-loop");
    const offered = buildToolOptions({ page, reach: geometryReach }).find(
      ({ key }) => key === "RenameDialog.confirm"
    )!;
    expect(offered.tool.args[0]!.closedSet).toMatchObject({
      kind: "instance",
      roots: [{}],
    });
    await call("RenameDialog.confirm", {
      ref: dialogRef,
      args: { name: "Mobile v2" },
    });
    expect(document.querySelector('[role="status"]')!.textContent).toBe(
      "Renamed Mobile app to Mobile v2"
    );
    expect(document.querySelector("#project-1 span")!.textContent).toBe(
      "Mobile v2"
    );
    expect(document.querySelector("#project-4 span")!.textContent).toBe(
      "Billing migration"
    );

    // Reopen it so the wrong ref is refused while the action is available.
    await call("ProjectRow.openRename", { ref: mobileRef });
    await probeRegisteredPomMembers();
    await expect(
      call("RenameDialog.confirm", {
        ref: billingRef,
        args: { name: "Wrong project" },
      })
    ).rejects.toThrow(
      `Cannot call RenameDialog.confirm on ref "${billingRef}": it is not a root of RenameDialog.`
    );
    expect(document.querySelector("#project-1 span")!.textContent).toBe(
      "Mobile v2"
    );
    expect(document.querySelector("#project-4 span")!.textContent).toBe(
      "Billing migration"
    );
    expect(document.querySelector("input")!.value).toBe("Mobile v2");
    expect(document.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(
      false
    );
  } finally {
    session.stop();
  }
});

it("#966 refuses a root-less dialog child of a collection item at registration", async () => {
  const { session, ProjectsPage } = projectsFixture(false);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    session.register(ProjectsPage);
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          'The Page Object class "RenameDialog" declares no root and has many instances below a collection: ProjectsPage.projects[].renameDialog (below a collection).',
      })
    );
    await probeRegisteredPomMembers();
    expect(
      session.ayme.tools
        .list()
        .filter(({ group }) => group === "pageObject")
        .map(({ name }) => name)
    ).toEqual(["ProjectRow.openRename"]);
    await expect(
      session.ayme.tools.run(
        "RenameDialog.confirm",
        { name: "Wrong project" },
        { by: callers.webmcp }
      )
    ).rejects.toThrow('There is no tool "RenameDialog.confirm".');
  } finally {
    session.stop();
  }
});
