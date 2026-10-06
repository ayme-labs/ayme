/**
 * Ayme page object actions as e2e project tools.
 *
 * Each `@ayme.action` the files declare becomes one mutating tool that the
 * replay cache records as a call (`replay: 'call'`): a replay runs the page
 * object method again with the recorded arguments instead of handing the
 * step to the model. Top-level actions only; collections are out of scope.
 */

import { pathToFileURL } from "node:url";
import { derivePomManifests } from "@ayme-dev/unplugin-ayme";
import { surfaceOf, type web } from "@e2e-dev/web";
import { jsonSchema, tool, type JSONSchema7 } from "ai";
import { defineTool, getToolContext } from "e2e/agent";

type Engine = ReturnType<typeof web>;

/** The web engine's context default timeout, restored after a replayed call shortened it. */
const ENGINE_DEFAULT_TIMEOUT_MS = 30_000;

/** The replay's time limit for this call, when trace replay runs it; undefined on a live call. */
function replayTimeout(options: object): number | undefined {
  try {
    return getToolContext(options).replayTimeoutMs;
  } catch {
    // Called outside the harness (a test calling execute directly): a live call.
    return undefined;
  }
}
type PageObjectClass = new (
  page: unknown
) => Record<string, (...args: unknown[]) => Promise<unknown>>;

/** One tool per page object action in `files`, named `Class_method` (providers allow `[a-zA-Z0-9_-]` only). */
export function aymeTools({
  engine,
  files,
}: {
  engine: Engine;
  files: readonly string[];
}): Record<string, ReturnType<typeof defineTool>> {
  const tools: Record<string, ReturnType<typeof defineTool>> = {};
  for (const file of files) {
    const manifests = derivePomManifests(file);
    // Top-level page objects only: a class another one holds as a Page
    // Object Child publishes its actions under its parent's path, not alone.
    const children = new Set(
      manifests.flatMap((manifest) =>
        manifest.components.map((component) => component.className)
      )
    );
    for (const manifest of manifests.filter(
      (candidate) => !children.has(candidate.className)
    )) {
      for (const action of manifest.tools) {
        tools[action.toolName.replaceAll(".", "_")] = defineTool(
          tool({
            description: action.description,
            inputSchema: jsonSchema(action.inputSchema as JSONSchema7),
            execute: async (
              input: Record<string, unknown>,
              options: object
            ) => {
              const surface = surfaceOf(engine);
              if (surface === undefined)
                throw new Error("aymeTools needs a web() engine");
              const page = surface.page();
              // A replayed call works as recorded or is broken: its locators
              // give up within the replay's limit, not Playwright's 30 s.
              const timeoutMs = replayTimeout(options);
              const module = (await import(pathToFileURL(file).href)) as Record<
                string,
                PageObjectClass
              >;
              const PageObject = module[manifest.className];
              if (PageObject === undefined)
                throw new Error(
                  `${file} does not export ${manifest.className}`
                );
              const pageObject = new PageObject(page);
              if (timeoutMs !== undefined) page.setDefaultTimeout(timeoutMs);
              try {
                await pageObject[action.methodName]!(
                  ...action.parameters.map((parameter) => input[parameter.name])
                );
              } finally {
                if (timeoutMs !== undefined)
                  page.setDefaultTimeout(ENGINE_DEFAULT_TIMEOUT_MS);
              }
              return `${action.toolName} done`;
            },
          }),
          { mutates: true, replay: "call" }
        );
      }
    }
  }
  return tools;
}
