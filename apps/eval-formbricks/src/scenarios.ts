/**
 * Startup scenarios are data: the task framing that opens the one message and
 * the references that framing should lead the agent to read, as paths inside
 * the skill's folder. Adding a scenario is adding an entry to
 * `startupScenarios`.
 */
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
};

const driveFraming =
  "Get ready to drive the web page that is already open in the browser your automation drives, with a Session of the ayme command connected to it.";

/** The framing says a Session is open on the page, so browser setup has no part in it. */
const notForDriving = [
  "references/browser-setup.md",
  "references/onboarding.md",
  "references/page-object-design.md",
  "references/ayme-page-objects.md",
  "references/live-mapping.md",
  "references/runtime-integration.md",
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
