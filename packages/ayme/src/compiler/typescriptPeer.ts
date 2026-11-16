// TypeScript is an optional peer of the package, so the compiler runs on the
// project's own and checks it is one the compiler supports.

/** The TypeScript range the compiler supports, as the peer in package.json states it. */
export const SUPPORTED_TYPESCRIPT = ">=5.4 <7";

/** Throws unless `version`, the project's TypeScript, is one the compiler supports. */
export function assertSupportedTypeScript(version: string): void {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (major < 5 || (major === 5 && minor < 4) || major >= 7)
    throw new Error(
      `[ayme] TypeScript ${version} is installed, and the Page Object compiler supports TypeScript ${SUPPORTED_TYPESCRIPT}.`
    );
}
