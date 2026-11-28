import type { RecorderWarning } from "../../contract";
import type { InteractionReport } from "../../timeline/domain";
import { valuesOf, type PlaywrightAction } from "./playwrightRecorder";

const isPlain = (value: unknown) =>
  ["string", "number", "boolean"].includes(typeof value);

/**
 * A report as told when the adapter could not read it: its type and the
 * plain values Playwright gave of the input, as a click's button and count
 * or an upload's files, with no element. It keeps the report's place among
 * the others: the lifecycle gives each report to the oldest input of its
 * kind still waiting for one, so a report left out would go to the input
 * after it.
 */
export function bareReportOf(action: PlaywrightAction): InteractionReport {
  const values = Object.entries(valuesOf(action)).filter(
    ([, value]) =>
      isPlain(value) || (Array.isArray(value) && value.every(isPlain))
  );
  return {
    type: action.name,
    selector: null,
    target: null,
    values: Object.fromEntries(values),
  };
}

/** An error as a warning can show it. Anything can be thrown, also a value
 * no text can be made of. */
function shown(cause: unknown): string {
  try {
    // Made text here, where a throw is caught: a message can be any value.
    return `${cause instanceof Error ? cause.message : cause}`;
  } catch {
    return "an error that cannot be shown";
  }
}

const notRecorded = (lost: string, cause: unknown): RecorderWarning => ({
  kind: "notRecorded",
  message: `${lost} The recorder's error: ${shown(cause)}`,
});

export const withoutElement = (name: string, cause: unknown) =>
  notRecorded(
    `A step is in the recording without its element: the recorder could not read Playwright's report of a ${name}.`,
    cause
  );

/** A step told as Playwright reported it, without what the adapter reads
 * of the page besides: an element's ancestors, a picked element's ref, an
 * upload's file names. */
export const readInPart = (name: string, cause: unknown) =>
  notRecorded(
    `A step is in the recording as Playwright reported it, without what the recorder reads of the page besides: the recorder could not finish reading the ${name}.`,
    cause
  );

export const revisionLost = (cause: unknown) =>
  notRecorded(
    "Typing may be missing its latest keys in the recording: the recorder could not read Playwright's revision of it. The trace still holds them.",
    cause
  );

export const reportLost = (cause: unknown) =>
  notRecorded(
    "A step may be missing from the recording: the recorder could not read a report of Playwright's. The trace still holds it.",
    cause
  );

/** What is told of a report that could not be read: a warning, and the
 * report told bare when one keeps its place (`bareReportOf`). A revision
 * has no place of its own, and a report of no open page none to keep. */
export function toldOfUnread(
  ofOpenPage: boolean,
  unread: {
    readonly action: PlaywrightAction | undefined;
    readonly revision: boolean;
    readonly cause: unknown;
  }
): { warning: RecorderWarning; report?: InteractionReport } {
  const { action, revision, cause } = unread;
  if (revision) return { warning: revisionLost(cause) };
  if (!ofOpenPage || !action) return { warning: reportLost(cause) };
  return {
    warning: withoutElement(action.name, cause),
    report: bareReportOf(action),
  };
}
