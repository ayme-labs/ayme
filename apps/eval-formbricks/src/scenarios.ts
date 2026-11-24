/**
 * Startup scenarios are data: the task framing that opens the one message and
 * the references that framing should lead the agent to read, as paths inside
 * the skill's folder. Adding a scenario is adding an entry to
 * `startupScenarios`.
 */
export type StubTool = { name: string; description: string };

export type StartupScenario = {
  id: string;
  /** Frames the task; it names no reference, so routing stays the skill's job. */
  framing: string;
  /** Read exactly these: a reference missing or one too many fails the run. */
  expected: string[];
  /** The surplus reads that matter most, named in the verdict on their own. */
  forbidden?: string[];
  /** Ignored by the verdict: read or not, neither expected nor surplus. The summary still counts them. */
  allowed?: string[];
  /** Listed by a stub `ayme` server, so the agent sees a connected page's tools; without them no server starts. */
  tools?: StubTool[];
};

/** What a connected page lists: the server's own tools, `page_objects` and two Page Object Tools. */
const connectedPageTools: StubTool[] = [
  {
    name: "ayme_connect",
    description:
      "Returns a link that connects a browser tab to this ayme MCP server.",
  },
  {
    name: "ayme_list_tools",
    description: "Lists the current tools of the connected page.",
  },
  {
    name: "ayme_call",
    description: "Runs one of the tools of the connected page by name.",
  },
  {
    name: "page_objects",
    description:
      "Returns the Page Objects on the page now as a tree: each one's class, its declared children with their values, and the id (po<n>) of each one that has a root.",
  },
  {
    name: "SurveyEditorPage.fillSurveyForm",
    description:
      "Replaces the survey's name and the text of the question open in the editor, the first one when the editor opens. Leave out what stays as it is.",
  },
  {
    name: "SurveyEditorPage.saveAndClose",
    description:
      "Publishes a draft survey, so it starts collecting responses; saves a published one.",
  },
];

const driveFraming =
  "Get ready to drive the web page that is already open and connected through ayme.";

/** The framing says the page is connected and its tools are listed, so browser setup has no part in it. */
const notForDriving = [
  "references/browser-setup.md",
  "references/onboarding.md",
  "references/page-object-design.md",
  "references/ayme-page-objects.md",
  "references/live-mapping.md",
  "references/runtime-integration.md",
  "references/peeks.md",
];

/** An agent that isn't driving a page never carries the driving guidance. */
const onlyForDriving = [
  "references/page-tools.md",
  "references/browser-setup.md",
];

export const startupScenarios: Record<string, StartupScenario> = {
  "drive-the-open-page": {
    id: "drive-the-open-page",
    framing: driveFraming,
    tools: connectedPageTools,
    expected: ["references/page-tools.md"],
    forbidden: notForDriving,
  },
  "set-up-ayme": {
    id: "set-up-ayme",
    framing: "Get ready to set up ayme in this project.",
    expected: ["references/onboarding.md", "references/runtime-integration.md"],
    allowed: [
      "references/page-object-design.md",
      "references/ayme-page-objects.md",
    ],
    forbidden: onlyForDriving,
  },
  "design-page-objects": {
    id: "design-page-objects",
    framing: "Get ready to design page object models for this project.",
    expected: [
      "references/page-object-design.md",
      "references/ayme-page-objects.md",
    ],
    forbidden: onlyForDriving,
  },
};

export const defaultScenarioId = "drive-the-open-page";
