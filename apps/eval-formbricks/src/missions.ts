/**
 * Missions are data: the values a run seeds, where the agent starts, the
 * task's steps and the end state the verdict checks. Adding a mission is
 * adding an entry to `missionDefinitions`.
 */

export type SurveyState = {
  surveyName: string;
  questionHeadline: string;
};

/** The screen the agent starts on. The editor needs a seeded survey and a signed-in browser; the sign-in page needs neither. */
export type StartScreen = "editor" | "sign-in";

export type MissionDefinition = {
  id: string;
  /**
   * The survey as seeded, before the agent touches it, or `null` for a mission
   * that seeds no survey and has the agent create one. `nonce` is short: the
   * agent types these.
   */
  initial: ((nonce: string) => SurveyState) | null;
  /** The survey as the verdict expects it after the run. */
  expected: (nonce: string) => SurveyState;
  start: StartScreen;
  /** The task's numbered steps, from the seeded mission. */
  steps: (mission: Mission) => string[];
  /** What must hold before the agent finishes: "Finish only after ...". */
  finish: string;
};

export const missionDefinitions: Record<string, MissionDefinition> = {
  "rename-survey-and-question": {
    id: "rename-survey-and-question",
    initial: (nonce) => ({
      surveyName: `Onboarding draft ${nonce}`,
      questionHeadline: `What brought you here today? (${nonce})`,
    }),
    expected: (nonce) => ({
      surveyName: `Onboarding feedback ${nonce}`,
      questionHeadline: `What would make onboarding easier for you? (${nonce})`,
    }),
    start: "editor",
    steps: (mission) => [
      `Change the survey's name to: ${mission.expected.surveyName}`,
      `Change the headline of its question to: ${mission.expected.questionHeadline}`,
      "Save and close the survey.",
      `Confirm that the survey summary page at ${mission.survey?.summaryUrl} shows the new name.`,
    ],
    finish: "the summary page shows the new survey name",
  },
  "sign-in-create-and-revise-survey": {
    id: "sign-in-create-and-revise-survey",
    initial: null,
    expected: (nonce) => ({
      surveyName: `Product feedback ${nonce}`,
      questionHeadline: `What almost stopped you from signing up? (${nonce})`,
    }),
    start: "sign-in",
    steps: (mission) => [
      `Sign in with the email ${mission.user.email} and the password ${mission.user.password}`,
      "Create a new survey from scratch.",
      `Change the survey's name to: ${mission.expected.surveyName}`,
      `Change the headline of its question to: ${firstQuestionHeadline(mission.nonce)}`,
      "Save and close the survey.",
      "Close the share dialog that opens on the survey summary page.",
      "Open the survey in the survey editor again.",
      `Change the headline of its question to: ${mission.expected.questionHeadline}`,
      "Save and close the survey.",
      "Confirm that the survey summary page shows the survey's name.",
    ],
    finish: "the summary page shows the survey's name",
  },
};

/** The headline the second mission sets first and then revises to the expected one. */
export function firstQuestionHeadline(nonce: string) {
  return `How did you hear about us? (${nonce})`;
}

export const defaultMissionId = "rename-survey-and-question";

/** The survey a run seeded, with the pages of it the mission names. */
export type SeededSurvey = {
  id: string;
  questionId: string;
  initial: SurveyState;
  editorUrl: string;
  summaryUrl: string;
};

/** A seeded mission: the definition's values bound to one run's rows. */
export type Mission = {
  id: string;
  runId: string;
  /** The short random tag in the values the agent types; the run id stays in the seeded names. */
  nonce: string;
  user: { id: string; name: string; email: string; password: string };
  organizationId: string;
  workspaceId: string;
  /** The seeded survey; `null` when the mission seeds none. */
  survey: SeededSurvey | null;
  expected: SurveyState;
  /** Where the agent starts, and whether the browser is signed in there. */
  start: { screen: StartScreen; url: string; signedIn: boolean };
};

export const signInPath = "/auth/login";

export function editorPath(workspaceId: string, surveyId: string) {
  return `/workspaces/${workspaceId}/surveys/${surveyId}/edit`;
}

export function summaryPath(workspaceId: string, surveyId: string) {
  return `/workspaces/${workspaceId}/surveys/${surveyId}/summary`;
}

/** The screen where a new organization creates its first survey; where sign-in lands without a survey. */
export function newSurveyPath(organizationId: string) {
  return `/organizations/${organizationId}/workspaces/new/survey`;
}

/** Where the agent starts: the seeded survey's editor, signed in, or the sign-in page, signed out. */
export function missionStart(
  definition: Pick<MissionDefinition, "start">,
  baseUrl: string,
  survey: SeededSurvey | null
): Mission["start"] {
  if (definition.start === "editor") {
    if (survey === null)
      throw new Error(
        "A mission that starts on the editor must seed a survey."
      );
    return { screen: "editor", url: survey.editorUrl, signedIn: true };
  }
  return { screen: "sign-in", url: `${baseUrl}${signInPath}`, signedIn: false };
}
