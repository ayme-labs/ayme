import { describe, expect, it } from "vitest";

import {
  defaultMissionId,
  missionDefinitions,
  missionStart,
  type SeededSurvey,
} from "./missions.ts";

const baseUrl = "http://localhost:3000";

const seededSurvey: SeededSurvey = {
  id: "survey-1",
  questionId: "question-1",
  initial: { surveyName: "Onboarding draft n", questionHeadline: "Q? (n)" },
  editorUrl: `${baseUrl}/workspaces/workspace-1/surveys/survey-1/edit`,
  summaryUrl: `${baseUrl}/workspaces/workspace-1/surveys/survey-1/summary`,
};

describe("the mission definitions", () => {
  it("default to the rename mission, which seeds a survey and starts signed in on its editor", () => {
    const definition = missionDefinitions[defaultMissionId];
    expect(definition.id).toBe("rename-survey-and-question");
    expect(definition.start).toBe("editor");
    expect(definition.initial?.("n")).toEqual({
      surveyName: "Onboarding draft n",
      questionHeadline: "What brought you here today? (n)",
    });
    expect(missionStart(definition, baseUrl, seededSurvey)).toEqual({
      screen: "editor",
      url: seededSurvey.editorUrl,
      signedIn: true,
    });
  });

  it("hold the sign-in mission, which seeds no survey and starts signed out on the sign-in page", () => {
    const definition = missionDefinitions["sign-in-create-and-revise-survey"];
    expect(definition.initial).toBeNull();
    expect(definition.start).toBe("sign-in");
    expect(definition.expected("n")).toEqual({
      surveyName: "Product feedback n",
      questionHeadline: "What almost stopped you from signing up? (n)",
    });
    expect(missionStart(definition, baseUrl, null)).toEqual({
      screen: "sign-in",
      url: `${baseUrl}/auth/login`,
      signedIn: false,
    });
  });

  it("refuse an editor start without a seeded survey", () => {
    expect(() => missionStart({ start: "editor" }, baseUrl, null)).toThrow(
      "must seed a survey"
    );
  });
});
