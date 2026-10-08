import { describe, expect, it } from "vitest";

import type { Mission } from "./missions.ts";
import { htmlToPlainText, judgeMission, type SurveyRecord } from "./verdict.ts";

const mission: Mission = {
  id: "rename-survey-and-question",
  runId: "run-1",
  nonce: "run-1",
  user: {
    id: "user-1",
    name: "eval-run-1",
    email: "eval-run-1@example.com",
    password: "not-a-real-password",
  },
  organizationId: "organization-1",
  workspaceId: "workspace-1",
  survey: {
    id: "survey-1",
    questionId: "question-1",
    initial: {
      surveyName: "Onboarding draft run-1",
      questionHeadline: "What brought you here today? (run-1)",
    },
    editorUrl:
      "http://localhost:3000/workspaces/workspace-1/surveys/survey-1/edit",
    summaryUrl:
      "http://localhost:3000/workspaces/workspace-1/surveys/survey-1/summary",
  },
  expected: {
    surveyName: "Onboarding feedback run-1",
    questionHeadline: "What would make onboarding easier for you? (run-1)",
  },
  start: {
    screen: "editor",
    url: "http://localhost:3000/workspaces/workspace-1/surveys/survey-1/edit",
    signedIn: true,
  },
};

/** The mission that seeds no survey: the agent creates the workspace's only one. */
const createMission: Mission = {
  ...mission,
  id: "sign-in-create-and-revise-survey",
  nonce: "ab12cd",
  survey: null,
  expected: {
    surveyName: "Product feedback ab12cd",
    questionHeadline: "What almost stopped you from signing up? (ab12cd)",
  },
  start: {
    screen: "sign-in",
    url: "http://localhost:3000/auth/login",
    signedIn: false,
  },
};

function survey(
  name: string,
  headline: string,
  options: { surveyId?: string; questionId?: string } = {}
): SurveyRecord {
  return {
    id: options.surveyId ?? "survey-1",
    name,
    blocks: [
      {
        id: "block-1",
        name: "Main Block",
        elements: [
          {
            id: options.questionId ?? "question-1",
            type: "openText",
            headline: { default: headline },
          },
        ],
      },
    ],
  };
}

describe("judgeMission with a seeded survey", () => {
  it("passes when the survey name and the question headline are the expected ones", () => {
    const verdict = judgeMission(mission, [
      survey(
        "Onboarding feedback run-1",
        "What would make onboarding easier for you? (run-1)"
      ),
    ]);
    expect(verdict).toEqual({
      pass: true,
      checks: {
        surveyExists: true,
        surveyNameMatches: true,
        questionExists: true,
        questionHeadlineMatches: true,
      },
      expected: {
        workspaceId: "workspace-1",
        surveyId: "survey-1",
        questionId: "question-1",
        surveyName: "Onboarding feedback run-1",
        questionHeadline: "What would make onboarding easier for you? (run-1)",
      },
      actual: {
        surveyNames: ["Onboarding feedback run-1"],
        surveyId: "survey-1",
        surveyName: "Onboarding feedback run-1",
        questionHeadline: "What would make onboarding easier for you? (run-1)",
        questionHeadlineStored:
          "What would make onboarding easier for you? (run-1)",
      },
    });
  });

  it("judges the seeded survey among others in the workspace", () => {
    const verdict = judgeMission(mission, [
      survey("Another survey", "Another question", {
        surveyId: "survey-0",
        questionId: "question-0",
      }),
      survey(
        "Onboarding feedback run-1",
        "What would make onboarding easier for you? (run-1)"
      ),
    ]);
    expect(verdict.pass).toBe(true);
    expect(verdict.actual.surveyId).toBe("survey-1");
    expect(verdict.actual.surveyNames).toEqual([
      "Another survey",
      "Onboarding feedback run-1",
    ]);
  });

  it("compares the visible text of a headline the rich-text editor stored as HTML", () => {
    const verdict = judgeMission(mission, [
      survey(
        "Onboarding feedback run-1",
        '<p class="fb-editor-paragraph"><span>What would make onboarding easier for you?&nbsp;(run-1)</span></p>'
      ),
    ]);
    expect(verdict.actual.questionHeadline).toBe(
      "What would make onboarding easier for you? (run-1)"
    );
    expect(verdict.pass).toBe(true);
  });

  it("fails a run that renamed the survey but left the question alone", () => {
    const verdict = judgeMission(mission, [
      survey(
        "Onboarding feedback run-1",
        "What brought you here today? (run-1)"
      ),
    ]);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.surveyNameMatches).toBe(true);
    expect(verdict.checks.questionHeadlineMatches).toBe(false);
  });

  it("fails when the expected headline landed on a different question", () => {
    const verdict = judgeMission(mission, [
      survey(
        "Onboarding feedback run-1",
        "What would make onboarding easier for you? (run-1)",
        { questionId: "question-2" }
      ),
    ]);
    expect(verdict.checks.questionExists).toBe(false);
    expect(verdict.actual.questionHeadline).toBeNull();
    expect(verdict.pass).toBe(false);
  });

  it("fails when the survey no longer exists", () => {
    const verdict = judgeMission(mission, []);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks).toEqual({
      surveyExists: false,
      surveyNameMatches: false,
      questionExists: false,
      questionHeadlineMatches: false,
    });
    expect(verdict.actual.surveyName).toBeNull();
    expect(verdict.actual.surveyNames).toEqual([]);
  });
});

describe("judgeMission without a seeded survey", () => {
  const created = (name: string, headline: string, surveyId = "survey-9") =>
    survey(name, headline, { surveyId, questionId: "question-9" });

  it("passes when the workspace holds one survey with the expected name and its first question has the second headline", () => {
    const verdict = judgeMission(createMission, [
      created(
        "Product feedback ab12cd",
        "What almost stopped you from signing up? (ab12cd)"
      ),
    ]);
    expect(verdict).toEqual({
      pass: true,
      checks: {
        surveyExists: true,
        surveyNameMatches: true,
        questionExists: true,
        questionHeadlineMatches: true,
      },
      expected: {
        workspaceId: "workspace-1",
        surveyId: null,
        questionId: null,
        surveyName: "Product feedback ab12cd",
        questionHeadline: "What almost stopped you from signing up? (ab12cd)",
      },
      actual: {
        surveyNames: ["Product feedback ab12cd"],
        surveyId: "survey-9",
        surveyName: "Product feedback ab12cd",
        questionHeadline: "What almost stopped you from signing up? (ab12cd)",
        questionHeadlineStored:
          "What almost stopped you from signing up? (ab12cd)",
      },
    });
  });

  it("fails when the workspace holds two surveys, even if one is right", () => {
    const verdict = judgeMission(createMission, [
      created(
        "Product feedback ab12cd",
        "What almost stopped you from signing up? (ab12cd)",
        "survey-8"
      ),
      created("Product feedback ab12cd", "How did you hear about us? (ab12cd)"),
    ]);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks.surveyExists).toBe(false);
    expect(verdict.actual.surveyId).toBeNull();
    expect(verdict.actual.surveyNames).toEqual([
      "Product feedback ab12cd",
      "Product feedback ab12cd",
    ]);
  });

  it("fails when the first headline was left in place", () => {
    const verdict = judgeMission(createMission, [
      created("Product feedback ab12cd", "How did you hear about us? (ab12cd)"),
    ]);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks).toEqual({
      surveyExists: true,
      surveyNameMatches: true,
      questionExists: true,
      questionHeadlineMatches: false,
    });
    expect(verdict.actual.questionHeadline).toBe(
      "How did you hear about us? (ab12cd)"
    );
  });

  it("fails when no survey was created", () => {
    const verdict = judgeMission(createMission, []);
    expect(verdict.pass).toBe(false);
    expect(verdict.checks).toEqual({
      surveyExists: false,
      surveyNameMatches: false,
      questionExists: false,
      questionHeadlineMatches: false,
    });
    expect(verdict.actual).toEqual({
      surveyNames: [],
      surveyId: null,
      surveyName: null,
      questionHeadline: null,
      questionHeadlineStored: null,
    });
  });

  it("judges the first question, whichever block holds it", () => {
    const verdict = judgeMission(createMission, [
      {
        id: "survey-9",
        name: "Product feedback ab12cd",
        blocks: [
          { id: "block-0", name: "Empty", elements: [] },
          {
            id: "block-1",
            name: "Main Block",
            elements: [
              {
                id: "q-1",
                type: "openText",
                headline: {
                  default: "What almost stopped you from signing up? (ab12cd)",
                },
              },
              { id: "q-2", type: "openText", headline: { default: "Second" } },
            ],
          },
        ],
      },
    ]);
    expect(verdict.pass).toBe(true);
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
