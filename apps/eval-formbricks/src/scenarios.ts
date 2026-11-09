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

/** What a connected page lists: the server's own tools, Browser Tools and two Page Object Tools, without `goal`. */
const connectedPageTools: StubTool[] = [
  {
    name: "ayme_connect",
    description:
      "Returns a link that connects a browser tab to this Ayme MCP server.",
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
    name: "snapshot",
    description:
      "Return the current live structural page state together with compact POM capability definitions known to Ayme.",
  },
  { name: "click", description: "Click one element." },
  {
    name: "fill",
    description: "Replace the value of one editable element with text.",
  },
  { name: "type", description: "Type text into one editable element." },
  {
    name: "navigate",
    description:
      "Open a URL on the page's own origin, or a path relative to the current page.",
  },
  {
    name: "SurveyEditorPage.fillSurveyForm",
    description:
      "Replaces the survey's name and the text of the question open in the editor, the first one when the editor opens. Leave out what stays as it is.",
  },
  {
    name: "SurveyEditorPage.saveAndClose",
    description:
      "Publishes a draft survey, so it starts collecting responses; saves a published one. A restricted draft first asks who can view it. When the survey is invalid, the editor stays open with the error.",
  },
];

/** Listed in one drive scenario and not the other, so the `goal` route is checked both ways. */
const goalTool: StubTool = {
  name: "goal",
  description:
    "Drive the page toward a goal in steps. Takes the goal and, in values, anything it needs typed in, each under a label of your own.",
};

const driveFraming =
  "Get ready to drive the web page that is already open and connected through Ayme.";

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
  "references/goal.md",
];

export const startupScenarios: Record<string, StartupScenario> = {
  "drive-the-open-page": {
    id: "drive-the-open-page",
    framing: driveFraming,
    tools: connectedPageTools,
    expected: ["references/page-tools.md"],
    forbidden: [...notForDriving, "references/goal.md"],
  },
  "drive-the-open-page-with-goal": {
    id: "drive-the-open-page-with-goal",
    framing: driveFraming,
    tools: [...connectedPageTools, goalTool],
    expected: ["references/page-tools.md", "references/goal.md"],
    forbidden: notForDriving,
  },
  "set-up-ayme": {
    id: "set-up-ayme",
    framing: "Get ready to set up Ayme in this project.",
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
