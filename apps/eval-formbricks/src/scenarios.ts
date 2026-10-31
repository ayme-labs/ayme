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
      "Get ready to drive the web page that is already open and connected through Ayme; the task follows in the next message.",
    // The framing says the page is connected, so browser setup has no part in it.
    expected: ["references/page-tools.md"],
  },
};

export const defaultScenarioId = "drive-the-open-page";
