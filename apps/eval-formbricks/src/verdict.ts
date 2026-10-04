import type { Mission } from "./missions.ts";

/** The seeded survey as read back from Formbricks's database; `null` when it is gone. */
export type SurveyRecord = {
  name: string;
  workspaceId: string;
  blocks: unknown;
} | null;

export type Verdict = {
  pass: boolean;
  checks: {
    surveyExists: boolean;
    workspaceMatches: boolean;
    surveyNameMatches: boolean;
    questionExists: boolean;
    questionHeadlineMatches: boolean;
  };
  expected: {
    surveyName: string;
    questionHeadline: string;
    workspaceId: string;
  };
  actual: {
    surveyName: string | null;
    questionHeadline: string | null;
    /** The headline as stored; the editor saves rich text as HTML. */
    questionHeadlineStored: string | null;
    workspaceId: string | null;
  };
};

/**
 * Pass or fail, from the mission and the survey record alone. The database
 * read stays outside, so this can be tested with plain objects.
 */
export function judgeMission(mission: Mission, survey: SurveyRecord): Verdict {
  const question = findElement(survey?.blocks, mission.questionId);
  const stored = headlineOf(question);
  const questionHeadline = stored === null ? null : htmlToPlainText(stored);
  const checks = {
    surveyExists: survey !== null,
    workspaceMatches: survey?.workspaceId === mission.workspaceId,
    surveyNameMatches: survey?.name === mission.expected.surveyName,
    questionExists: question !== undefined,
    questionHeadlineMatches:
      questionHeadline === mission.expected.questionHeadline,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    expected: {
      surveyName: mission.expected.surveyName,
      questionHeadline: mission.expected.questionHeadline,
      workspaceId: mission.workspaceId,
    },
    actual: {
      surveyName: survey?.name ?? null,
      questionHeadline,
      questionHeadlineStored: stored,
      workspaceId: survey?.workspaceId ?? null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Formbricks stores questions as `blocks[].elements[]`. */
function findElement(blocks: unknown, elementId: string) {
  if (!Array.isArray(blocks)) return undefined;
  for (const block of blocks) {
    if (!isRecord(block) || !Array.isArray(block.elements)) continue;
    const element = block.elements.find(
      (candidate: unknown) => isRecord(candidate) && candidate.id === elementId
    );
    if (element !== undefined) return element as Record<string, unknown>;
  }
  return undefined;
}

function headlineOf(element: Record<string, unknown> | undefined) {
  const headline = element?.headline;
  if (!isRecord(headline)) return null;
  return typeof headline.default === "string" ? headline.default : null;
}

/** The visible text of a stored rich-text value: tags dropped, entities decoded, whitespace collapsed. */
export function htmlToPlainText(value: string) {
  let output = "";
  let insideTag = false;
  for (const character of value) {
    if (character === "<" && !insideTag) {
      insideTag = true;
      continue;
    }
    if (character === ">" && insideTag) {
      insideTag = false;
      output += " ";
      continue;
    }
    if (!insideTag) output += character;
  }
  return output
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll(/\s+/g, " ")
    .trim();
}
