/** Why a Session could not start, or a later build failed. Its message is
 * the sentence `ayme open` prints: what was found, and what to do about it.
 * `first` is the first of several reasons on one line, as a listing names
 * a failing build. */
export class SessionStartError extends Error {
  constructor(
    message: string,
    readonly first?: string
  ) {
    super(message);
  }
}

/** Why a Session could not start when its start broke in a way nobody
 * expected, such as a folder that could not be made. */
export const brokenStart = (defect: unknown): SessionStartError =>
  new SessionStartError(
    `The Session could not start: ${defect instanceof Error ? defect.message : String(defect)}`
  );
