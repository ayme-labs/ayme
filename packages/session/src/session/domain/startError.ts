/** Why a Session could not start. Its message is the sentence `ayme open`
 * prints: what was found, and what to do about it. */
export class SessionStartError extends Error {}

/** Why a Session could not start when its start broke in a way nobody
 * expected, such as a folder that could not be made. */
export const brokenStart = (defect: unknown): SessionStartError =>
  new SessionStartError(
    `The Session could not start: ${defect instanceof Error ? defect.message : String(defect)}`
  );
