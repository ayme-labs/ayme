# Errors

The errors Ayme's packages throw, what each means, and how a published tool reports a failure to an agent.

## Error classes

Ayme's own runtime failures are `AymeError` subclasses, exported from `@ayme-dev/ayme`. Each `name` is its class name, and `kind` tells them apart:

| Class                | `kind`       | Meaning                                                           |
| -------------------- | ------------ | ----------------------------------------------------------------- |
| `ToolInputError`     | `input`      | The caller's arguments are wrong.                                 |
| `RefResolutionError` | `resolution` | A Structural Ref or Page Object instance does not match the page. |
| `RuntimeStateError`  | `runtime`    | Ayme is not set up for this call.                                 |

`ayme.tools.run` throws them. Failures of the browser Page, such as a Playwright `TimeoutError` with its call log, pass through unchanged.

## How an agent sees a failure

A published tool never throws, because WebMCP drops the reason of a rejected call: native Chrome reports only a generic `UnknownError`. Every tool Ayme publishes, `snapshot` and `goal` included, resolves a failure as an MCP tool-failure result instead:

```json
{
  "content": [
    {
      "type": "text",
      "text": "RefResolutionError: Cannot click ref \"e12\": removed."
    }
  ],
  "isError": true
}
```

- `document.modelContext.executeTool()` resolves with this result's JSON, so a caller must read `isError`; the call does not reject.
- The text is the error's full message, prefixed with the error's name unless the name is plain `Error`. A browser action failure keeps playwright-lite's name and call log, such as `TimeoutError: locator.click: Timeout 1000ms exceeded.` followed by `Call log:`.
- The result has no `structuredContent`.
- Inside the Goal Loop, a failed step does not end the call: the loop records its message in the Handover's history.
- Whether an MCP client connected through the WebMCP local relay sees `isError` depends on the relay.

## Tool calls

| Error                | Message                                                                                                           | Cause                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ToolInputError`     | `Tool input must be an object.`                                                                                   | The input is not an object.                                                                                                             |
| `ToolInputError`     | `The option "<name>" is not supported.`, `Unexpected input property <name>.`                                      | The input has a property the tool does not declare.                                                                                     |
| `ToolInputError`     | `The input property "<name>" is required.`, `Missing required input property <name>.`                             | A required property is missing.                                                                                                         |
| `ToolInputError`     | `Input property <name> must be a <type>.`, and the `integer`, `array`, minimum, enum and nested-property variants | A property has the wrong type or value.                                                                                                 |
| `ToolInputError`     | `The target "<target>" is neither a Structural Ref nor a selector this runtime supports: …`                       | A Browser Tool's `target` is not a ref or a supported selector.                                                                         |
| `ToolInputError`     | `goal requires a string goal and an integer maxSteps.`                                                            | `goal` was called without them.                                                                                                         |
| `ToolInputError`     | `POM definition names must be an array.`, `… must be strings.`                                                    | `snapshot`'s `names` is malformed.                                                                                                      |
| `RefResolutionError` | `Cannot <action> "<target>": <reason>.`, `Cannot <action> ref "<ref>": <reason>.`                                 | The ref or selector matches no element or several elements, the ref's node was removed, or the ref is a synthetic observation-only ref. |
| `RefResolutionError` | `Ref "<ref>" does not match a present <Model> instance at <path> (tool <name>).`                                  | A collection tool's `ref` is not the root of an item of that collection.                                                                |
| `RefResolutionError` | `Ref "<ref>" does not match a present instance at <path> (tool <name>): <reason>.`                                | A collection tool's `ref` is unknown or its node was removed.                                                                           |
| `RefResolutionError` | `No <Model> instance exists at <path>.`                                                                           | A child Page Object a tool acts on is not there.                                                                                        |
| `RefResolutionError` | `POM definition "<name>" is ambiguous.`                                                                           | Two different models share the name passed to `snapshot`.                                                                               |
| `RuntimeStateError`  | `Cannot run the tool "<name>": the Ayme runtime session is not started.`                                          | `ayme.tools.run` before `start()` or after the session stopped.                                                                         |
| `RuntimeStateError`  | `The tool "<name>" is not live.`                                                                                  | No live tool has that unprefixed name, such as a Page Object Tool whose class is not registered or whose root is not available.         |

## Setup

| Error               | Message                                                                                                | Cause                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RuntimeStateError` | `The Ayme runtime already has an active owner.`                                                        | A second session started in the same document. One owns the document at a time.                                                                    |
| `RuntimeStateError` | `Cannot register the Page Object "<Model>": a different class with that name is already registered. …` | Two classes share a name, so their tools would too. Rename one.                                                                                    |
| `RuntimeStateError` | `The imported page object has no compiler-derived Ayme metadata.`                                      | The model was not compiled by the build plugin: it is not marked `@ayme`, or the plugin does not transform its file.                               |
| `RuntimeStateError` | `Cannot publish the tool "<name>": another published tool already uses that name.`                     | Two tools, such as a Custom Tool and a Page Object Tool, share a name. Publication fails, and `ayme.tools.run` throws it until the clash is fixed. |
| `RuntimeStateError` | `createDecisionEndpoint must run on the server.`                                                       | `createDecisionEndpoint` was called where `document` exists.                                                                                       |

## Framework packages

| Package                            | Message                                                                                                                       | Cause                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `@ayme-dev/vue`, `@ayme-dev/react` | `AymeProvider cannot be nested beneath another Ayme runtime owner.`                                                           | A second owner beneath the first.                           |
| `@ayme-dev/vue`, `@ayme-dev/react` | `The provider options must stay fixed while mounted. Remount the provider to change them.`                                    | A provider option changed while mounted.                    |
| `@ayme-dev/vue`                    | `Configure pageFactory, ignore, customTools, goalLoop and webMCP on the ancestor AymeProvider or standalone useAyme owner.`   | `useAyme(options)` beneath an owner.                        |
| `@ayme-dev/vue`                    | `useAyme must be called within an active Vue effect scope`, and the same for `usePageObject`                                  | Called outside `setup` or an effect scope.                  |
| `@ayme-dev/vue`                    | `usePageObject requires useAyme() or an AymeProvider in this scope or an ancestor component.`                                 | No owner above.                                             |
| `@ayme-dev/react`                  | `Ayme hooks require an ancestor AymeProvider.`                                                                                | `useAyme` or `usePageObject` without a provider above.      |
| `@ayme-dev/react`                  | `The Page Object model and provider must stay fixed while mounted. Remount the component to change them.`                     | `usePageObject` got a different model.                      |
| `@ayme-dev/svelte`                 | `useAyme(options) already has an active owner. Call it once, in the root +layout.svelte or App.svelte.` (`RuntimeStateError`) | A second owner while one is active.                         |
| `@ayme-dev/svelte`                 | `Configure Ayme on the ancestor useAyme(options) owner, not beneath it.`                                                      | `useAyme(options)` beneath an owner.                        |
| `@ayme-dev/svelte`                 | `usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte.`                                 | No owner above.                                             |
| `@ayme-dev/angular`                | `provideAyme cannot be nested beneath another Ayme runtime owner.`                                                            | `provideAyme` beneath another.                              |
| `@ayme-dev/angular`                | `Ayme requires provideAyme() in an ancestor injector.`                                                                        | `injectAyme` or `injectPageObject` without `provideAyme`.   |
| `@ayme-dev/angular`                | `Ayme needs an Angular application project; …`                                                                                | `ng add` ran in a workspace without an application project. |
| `@ayme-dev/angular`                | `Ayme could not read the Angular major from the @angular/core dependency in package.json (…).`                                | `ng add` found no readable `@angular/core` version.         |
| `@ayme-dev/inspector`              | `No Ayme runtime session has started.` (`RuntimeStateError`), shown in a run card                                             | A tool was run from the panel before Ayme started.          |

## Build plugin

These fail the build or the dev server.

| Message                                                                                                                                                | Cause                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Unsupported Page Object Tool input type for <Model>.<method>(<parameter>): <type>.`                                                                   | A parameter type the compiler cannot turn into a schema; see [Page Object Models](../guides/page-object-models.md). |
| `Page Object Action <Model>.<method> needs identifier parameter names.`                                                                                | A destructured parameter.                                                                                           |
| `Page Object Child "<member>" is ambiguous: <classes>.`                                                                                                | A member's type intersects several Page Object Models.                                                              |
| `<Model> is marked with @WebMCP, which was replaced by @ayme. …`, and the same for `@WebMCP.tool`                                                      | The decorators from before the rename.                                                                              |
| `Could not find a tsconfig.json for POM source <file>.`                                                                                                | No tsconfig above the model and no `tsconfigPath`.                                                                  |
| `Could not read TypeScript project configuration <path>: …`                                                                                            | The tsconfig the compiler found has errors.                                                                         |
| `Could not read POM source <file>.`                                                                                                                    | The model's file could not be read.                                                                                 |
| `A Page Object Model needs a class name.`, `Page Object Action in <Model> needs an identifier method name.`                                            | An anonymous class, or an action with a computed name.                                                              |
| `Could not transpile Ayme POM <file>: …`                                                                                                               | TypeScript could not compile the model.                                                                             |
| `The publish option was removed. Turn WebMCP publication on with webMCP.enabled where Ayme starts: …`                                                  | The plugin got the removed `publish` option.                                                                        |
| `playwright contains unsupported option(s): …`, `playwright.config must be a non-empty string`, and the other `playwright` option checks (`TypeError`) | A malformed `playwright` option; see the [build plugin reference](build-plugin.md#playwright-settings).             |
| `playwright.project requires an explicit playwright.config path` (`TypeError`)                                                                         | `project` without `config`.                                                                                         |
| `Could not load Playwright config "<path>": …`                                                                                                         | The config file is missing or failed to load.                                                                       |
| `Unsupported Playwright config loader …`                                                                                                               | Loading a config needs Playwright 1.62; the installed loader has another version or shape.                          |
| `Playwright project "<name>" must exist exactly once in <path>; found <count>.`                                                                        | `project` names no project, or several.                                                                             |
| `Playwright projects have different supported settings (<fields>); set playwright.project explicitly.`                                                 | Several projects disagree and no `project` was set.                                                                 |
| `Ayme's Angular plugin has no option(s): …` (`TypeError`)                                                                                              | An unknown Angular plugin option, or the plugin referenced as a plain string.                                       |
| `Ayme did not compile Page Object Model <file>.`                                                                                                       | The Angular plugin could not compile a model it claimed.                                                            |
| `tsconfigPath must be a string` (`TypeError`)                                                                                                          | A non-string Angular `tsconfigPath`.                                                                                |
| `Ayme's Turbopack loader requires loader dependency tracking.`                                                                                         | The bundler running the loader cannot track dependencies.                                                           |

## Decision Endpoint

`decisionEndpoint` throws `<status> <error text>` on a non-2xx response and `The Decision Endpoint returned an invalid response.` on a malformed body. In the Goal Loop, either ends the run with the Handover reason `decide_failed`.

## Testing entry

`executePublishedTool` throws `<name> is not published.` when no published tool has that name, prefix included.
