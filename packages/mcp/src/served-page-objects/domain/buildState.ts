import { buildFailure, type BuildError } from "./buildFailure";

/** The built modules, by their path under the served path. */
export type BuiltModules = ReadonlyMap<string, string>;

export type SettledBuildState = Readonly<
  { entry: string } & (
    | { kind: "cannot-start"; error: string }
    | {
        kind: "watching-install";
        error: string;
        installFiles: readonly string[];
      }
    | { kind: "never-built"; errors: readonly BuildError[] }
    | { kind: "built"; modules: BuiltModules }
    | {
        kind: "rebuild-failed";
        modules: BuiltModules;
        errors: readonly BuildError[];
      }
  )
>;

export type PageObjectsBuildState =
  | { readonly kind: "starting"; readonly entry: string }
  | { readonly kind: "building"; readonly entry: string }
  | SettledBuildState;

/** The log line for a transition, when there is one. */
export function buildLog(
  state: PageObjectsBuildState,
  previous: PageObjectsBuildState
): string | undefined {
  switch (state.kind) {
    case "starting":
    case "building":
      return undefined;
    case "watching-install":
      return state.error;
    case "cannot-start":
      // A watcher stopping changes the state without another failed start.
      return previous.kind === "watching-install" ? undefined : state.error;
    case "never-built":
    case "rebuild-failed":
      return buildFailure({
        ...state,
        lastGood: state.kind === "rebuild-failed",
      });
    case "built": {
      const verb =
        previous.kind === "built" || previous.kind === "rebuild-failed"
          ? "Rebuilt"
          : "Built";
      return `${verb} the Page Objects entry ${state.entry}.`;
    }
  }
}
