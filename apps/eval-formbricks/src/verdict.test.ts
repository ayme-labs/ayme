import { describe, expect, it } from "vitest";

import type { Mission } from "./missions.ts";
import { htmlToPlainText, judgeMission } from "./verdict.ts";

const mission: Mission = {
  id: "rename-survey-and-question",
  runId: "run-1",
  user: {
    id: "user-1",
    name: "eval-run-1",
    email: "eval-run-1@example.com",
    password: "not-a-real-password",
  },
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  surveyId: "survey-1",
  questionId: "question-1",
  initial: {
    surveyName: "Onboarding draft run-1",
    questionHeadline: "What brought you here today? (run-1)",
  },
  expected: {
    surveyName: "Onboarding feedback run-1",
    questionHeadline: "What would make onboarding easier for you? (run-1)",
  },
  startUrl:
    "http://localhost:3000/workspaces/workspace-1/surveys/survey-1/edit",
  summaryUrl:
    "http://localhost:3000/workspaces/workspace-1/surveys/survey-1/summary",
};

function survey(name: string, headline: string, questionId = "question-1") {
  return {
    name,
    workspaceId: "workspace-1",
    blocks: [
      {
        id: "block-1",
        name: "Main Block",
        elements: [
          { id: questionId, type: "openText", headline: { default: headline } },
        ],
      },
    ],
  };
}

describe("judgeMission", () => {
  it("passes when the survey name and the question headline are the expected ones", () => {
    const verdict = judgeMission(
      mission,
      survey(
        "Onboarding feedback run-1",
        "What would make onboarding easier for you? (run-1)"
      )
    );
    expect(verdict).toEqual({
      pass: true,
      checks: {
        surveyExists: true,
        workspaceMatches: true,
        surveyNameMatches: true,
        questionExists: true,
        questionHeadlineMatches: true,
      },
      expected: {
        surveyName: "Onboarding feedback run-1",
        questionHeadline: "What would make onboarding easier for you? (run-1)",
        workspaceId: "workspace-1",
      },
      actual: {
        surveyName: "Onboarding feedback run-1",
        questionHeadline: "What would make onboarding easier for you? (run-1)",
        questionHeadlineStored:
          "What would make onboarding easier for you? (run-1)",
        workspaceId: "workspace-1",
      },
    });
  });

  it("compares the visible text of a headline the rich-text editor stored as HTML", () => {
    const verdict = judgeMission(
      mission,
      survey(
        "Onboarding feedback run-1",
        '<p class="fb-editor-paragraph"><span>What would make onboarding easier for you?&nbsp;(run-1)</span></p>'
      )
    );
    expect(verdict.actual.questionHeadline).toBe(
      "What would make onboarding easier for you? (run-1)"
    );
    expect(verdict.pass).toBe(true);
  });

  it("fails a run that renamed the survey but left the question alone", () => {
    const verdict = judgeMission(
      mission,
      survey(
        "Onboarding feedback run-1",
        "What brought you here today? (run-1)"
      )
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.surveyNameMatches).toBe(true);
    expect(verdict.checks.questionHeadlineMatches).toBe(false);
  });

  it("fails when the expected headline landed on a different question", () => {
    const verdict = judgeMission(
      mission,
      survey(
        "Onboarding feedback run-1",
        "What would make onboarding easier for you? (run-1)",
        "question-2"
      )
    );
    expect(verdict.checks.questionExists).toBe(false);
    expect(verdict.actual.questionHeadline).toBeNull();
    expect(verdict.pass).toBe(false);
  });

  it("fails when the survey no longer exists", () => {
    const verdict = judgeMission(mission, null);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks).toEqual({
      surveyExists: false,
      workspaceMatches: false,
      surveyNameMatches: false,
      questionExists: false,
      questionHeadlineMatches: false,
    });
    expect(verdict.actual.surveyName).toBeNull();
  });
});

describe("htmlToPlainText", () => {
  it("drops tags, decodes entities and collapses whitespace", () => {
    expect(
      htmlToPlainText(
        "<p><b>Tom</b> &amp; <i>Jerry</i>&nbsp;&lt;3</p>\n<p> go </p>"
      )
    ).toBe("Tom & Jerry <3 go");
  });
});
