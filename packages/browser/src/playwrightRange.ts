// The attribute lets Node load this file from source.
import range from "../playwright-range.json" with { type: "json" };

/** The Playwright versions ayme supports, from the one place that states
 * them: `playwright-range.json` beside this package. */
export const SUPPORTED_PLAYWRIGHT: {
  readonly floor: string;
  readonly lastVerified: string;
} = range;

/** Where a version stands against the supported range, by its minor. */
export function placeInRange(version: string): "below" | "within" | "above" {
  const minor = (stated: string) => {
    const [major = 0, minor = 0] = stated.split(".").map(Number);
    return major * 1000 + minor;
  };
  if (minor(version) < minor(range.floor)) return "below";
  if (minor(version) > minor(range.lastVerified)) return "above";
  // Callers ask only whether a version is below or above the range.
  // Stryker disable next-line StringLiteral
  return "within";
}
