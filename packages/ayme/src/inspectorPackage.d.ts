// The part of the optional @ayme-dev/inspector peer the session uses. The
// Inspector builds after this package, so its own types may not exist yet.
declare module "@ayme-dev/inspector" {
  export function mountInspector(): { dispose(): void };
}
