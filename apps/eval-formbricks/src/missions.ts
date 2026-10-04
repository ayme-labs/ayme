/**
 * Missions are data: the values a run seeds, where the agent starts and the
 * end state the verdict checks. Adding a mission is adding an entry to
 * `missionDefinitions`.
 */

export type SurveyState = {
  surveyName: string;
  questionHeadline: string;
};

export type MissionDefinition = {
  id: string;
  /** The survey as seeded, before the agent touches it. `nonce` is short: the agent types these. */
  initial: (nonce: string) => SurveyState;
  /** The survey as the verdict expects it after the run. */
  expected: (nonce: string) => SurveyState;
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
  },
};

export const defaultMissionId = "rename-survey-and-question";

/** A seeded mission: the definition's values bound to one run's rows. */
export type Mission = {
  id: string;
  runId: string;
  /** The short random tag in the values the agent types; the run id stays in the seeded names. */
  nonce: string;
  user: { id: string; name: string; email: string; password: string };
  organizationId: string;
  workspaceId: string;
  surveyId: string;
  questionId: string;
  initial: SurveyState;
  expected: SurveyState;
  /** The survey editor, where the agent starts, signed in. */
  startUrl: string;
  /** The survey summary page the mission ends on. */
  summaryUrl: string;
};

export function editorPath(workspaceId: string, surveyId: string) {
  return `/workspaces/${workspaceId}/surveys/${surveyId}/edit`;
}

export function summaryPath(workspaceId: string, surveyId: string) {
  return `/workspaces/${workspaceId}/surveys/${surveyId}/summary`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProperty(value: Record<string, unknown>, key: string): string {
  const property = value[key];
  if (typeof property !== "string")
    throw new TypeError(`Mission: expected string property ${key}`);
  return property;
}

function surveyState(value: unknown, key: string): SurveyState {
  if (!isRecord(value)) throw new TypeError(`Mission: expected object ${key}`);
  return {
    surveyName: stringProperty(value, "surveyName"),
    questionHeadline: stringProperty(value, "questionHeadline"),
  };
}

/** Reads a stored `mission.json` back, rejecting anything that is not a mission. */
export function parseMission(value: unknown): Mission {
  if (!isRecord(value)) throw new TypeError("Mission: expected an object");
  const user = value.user;
  if (!isRecord(user)) throw new TypeError("Mission: expected object user");
  return {
    id: stringProperty(value, "id"),
    runId: stringProperty(value, "runId"),
    nonce: stringProperty(value, "nonce"),
    user: {
      id: stringProperty(user, "id"),
      name: stringProperty(user, "name"),
      email: stringProperty(user, "email"),
      password: stringProperty(user, "password"),
    },
    organizationId: stringProperty(value, "organizationId"),
    workspaceId: stringProperty(value, "workspaceId"),
    surveyId: stringProperty(value, "surveyId"),
    questionId: stringProperty(value, "questionId"),
    initial: surveyState(value.initial, "initial"),
    expected: surveyState(value.expected, "expected"),
    startUrl: stringProperty(value, "startUrl"),
    summaryUrl: stringProperty(value, "summaryUrl"),
  };
}
