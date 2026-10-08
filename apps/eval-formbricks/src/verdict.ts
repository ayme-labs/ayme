import type { Mission } from "./missions.ts";

/** A survey of the seeded workspace as read back from Formbricks's database. */
export type SurveyRecord = {
  id: string;
  name: string;
  blocks: unknown;
};

export type Verdict = {
  pass: boolean;
  checks: {
    /** The seeded survey is still in the workspace; without a seeded survey, the workspace holds exactly one. */
    surveyExists: boolean;
    surveyNameMatches: boolean;
    /** The seeded question is still in the survey; without a seeded survey, the survey has a first question. */
    questionExists: boolean;
    questionHeadlineMatches: boolean;
  };
  expected: {
    workspaceId: string;
    /** The seeded survey and question; `null` for a mission whose survey the agent creates. */
    surveyId: string | null;
    questionId: string | null;
    surveyName: string;
    questionHeadline: string;
  };
  actual: {
    /** Every survey of the workspace, in creation order. */
    surveyNames: string[];
    /** The survey judged: the seeded one, or the workspace's only one. */
    surveyId: string | null;
    surveyName: string | null;
    questionHeadline: string | null;
    /** The headline as stored; the editor saves rich text as HTML. */
    questionHeadlineStored: string | null;
  };
};

/**
 * Pass or fail, from the mission and the workspace's surveys alone. The
 * database read stays outside, so this can be tested with plain objects.
 */
export function judgeMission(
  mission: Mission,
  surveys: SurveyRecord[]
): Verdict {
  const seeded = mission.survey;
  const survey =
    seeded === null
      ? surveys.length === 1
        ? surveys[0]
        : undefined
      : surveys.find((candidate) => candidate.id === seeded.id);
  const question =
    seeded === null
      ? firstElement(survey?.blocks)
      : findElement(survey?.blocks, seeded.questionId);
  const stored = headlineOf(question);
  const questionHeadline = stored === null ? null : htmlToPlainText(stored);
  const checks = {
    surveyExists: survey !== undefined,
    surveyNameMatches: survey?.name === mission.expected.surveyName,
    questionExists: question !== undefined,
    questionHeadlineMatches:
      questionHeadline === mission.expected.questionHeadline,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    expected: {
      workspaceId: mission.workspaceId,
      surveyId: seeded?.id ?? null,
      questionId: seeded?.questionId ?? null,
      surveyName: mission.expected.surveyName,
      questionHeadline: mission.expected.questionHeadline,
    },
    actual: {
      surveyNames: surveys.map((candidate) => candidate.name),
      surveyId: survey?.id ?? null,
      surveyName: survey?.name ?? null,
      questionHeadline,
      questionHeadlineStored: stored,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Formbricks stores questions as `blocks[].elements[]`, in order. */
function elements(blocks: unknown): Record<string, unknown>[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((block: unknown) =>
    isRecord(block) && Array.isArray(block.elements)
      ? block.elements.filter(isRecord)
      : []
  );
}

function findElement(blocks: unknown, elementId: string) {
  return elements(blocks).find((element) => element.id === elementId);
}

function firstElement(blocks: unknown) {
  return elements(blocks)[0];
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
