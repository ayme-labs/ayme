import type { RecorderWarning } from "../../contract";
import type { InteractionReport } from "../../timeline/domain";
import type { PlaywrightAction } from "./playwrightRecorder";

/** The parts of Playwright's report that name the element, or that the
 * adapter does not keep. */
const NOT_VALUES = new Set([
  "name",
  "selector",
  "ref",
  "ariaSnapshot",
  "signals",
]);

/**
 * A report as told when the adapter could not read it: its type and the
 * plain values Playwright gave of the input, as a click's button and count,
 * with no element. It keeps the report's place among the others: the
 * lifecycle gives each report to the oldest input of its kind still waiting
 * for one, so a report left out would go to the input after it. Undefined
 * when even that cannot be read off it.
 */
export function bareReportOf(
  action: PlaywrightAction
): InteractionReport | undefined {
  try {
    const values = Object.entries(action).filter(
      ([key, value]) =>
        !NOT_VALUES.has(key) &&
        ["string", "number", "boolean"].includes(typeof value)
    );
    return {
      type: action.name,
      selector: null,
      target: null,
      values: Object.fromEntries(values),
    };
  } catch {
    return undefined;
  }
}

/** An error as a warning can show it. Anything can be thrown, also a value
 * no text can be made of. */
function shown(cause: unknown): string {
  try {
    return cause instanceof Error ? cause.message : String(cause);
  } catch {
    return "an error that cannot be shown";
  }
}

const notRecorded = (lost: string, cause: unknown): RecorderWarning => ({
  kind: "notRecorded",
  message: `${lost} The recorder's error: ${shown(cause)}`,
});

/** A step told bare (`bareReportOf`). */
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

/** A revision of typing left out. */
export const revisionLost = (cause: unknown) =>
  notRecorded(
    "Typing may be missing its latest keys in the recording: the recorder could not read Playwright's revision of it. The trace still holds them.",
    cause
  );

/** A report left out, as nothing of it could be read. */
export const reportLost = (cause: unknown) =>
  notRecorded(
    "A step may be missing from the recording: the recorder could not read a report of Playwright's. The trace still holds it.",
    cause
  );
