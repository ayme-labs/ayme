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
};

export const startupScenarios: Record<string, StartupScenario> = {
  "drive-the-open-page": {
    id: "drive-the-open-page",
    framing:
      "Get ready to drive the web page that is already open and connected through Ayme.",
    // The framing says the page is connected, so browser setup has no part in it.
    expected: ["references/page-tools.md"],
  },
  "set-up-ayme": {
    id: "set-up-ayme",
    framing: "Get ready to set up Ayme in this project.",
    expected: ["references/onboarding.md"],
    // An agent only installing Ayme never carries the driving guidance.
    forbidden: ["references/page-tools.md", "references/browser-setup.md"],
  },
  "design-page-objects": {
    id: "design-page-objects",
    framing: "Get ready to design page objects for a flow in this project.",
    expected: ["references/page-object-design.md"],
  },
};

export const defaultScenarioId = "drive-the-open-page";
