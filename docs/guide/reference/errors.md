# Errors

The errors the Ayme runtime throws, what each means, and how a published tool reports a failure to an agent.

## Error classes

Ayme's own runtime failures are `AymeError` subclasses, exported from `@ayme-dev/ayme`. Each `name` is its class name, and `kind` tells them apart:

| Class                | `kind`       | Meaning                                                           |
| -------------------- | ------------ | ----------------------------------------------------------------- |
| `ToolInputError`     | `input`      | The caller's arguments are wrong.                                 |
| `RefResolutionError` | `resolution` | A Structural Ref or Page Object instance does not match the page. |
| `RuntimeStateError`  | `runtime`    | Ayme is not set up for this call.                                 |

A `RuntimeStateError` that callers branch on also has a `code` (`RuntimeStateErrorCode`), so they need not match its message. The only one is `active-owner`, for the owner conflict below.

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
- A call of an unavailable tool is refused the same way, before anything runs, with its reason: `RuntimeStateError: Panel.remove is unavailable: No item is selected.`
- The result has no `structuredContent`.
- Inside the Goal Loop, a failed step does not end the call: the loop records its message in the Handover's history.
- A coding agent connected through [Ayme's MCP server](../guides/connect-an-agent.md) gets the same text in an MCP result with `isError: true`.

## Messages

Most messages say what is wrong. These are the ones whose cause is less obvious:

| Message                                                                                                  | Cause                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot <action> "<target>": <reason>.`, `Cannot <action> ref "<ref>": <reason>.` (`RefResolutionError`) | The ref or selector matches no element or several, the ref's node was removed, or the ref is a synthetic, observation-only ref.                                                                                                                                                                                                                                                                                |
| `Ref "<ref>" does not match a present <Model> instance at <path> (tool <name>).` (`RefResolutionError`)  | A collection tool's `ref` is not the Page Object Root of an item of that collection.                                                                                                                                                                                                                                                                                                                           |
| `There is no tool "<name>".` (`RuntimeStateError`)                                                       | No tool has that unprefixed name, such as a Page Object Tool whose class is not registered.                                                                                                                                                                                                                                                                                                                    |
| `<Tool> is unavailable: <reason>.`, or `<Tool> is unavailable.` (`RuntimeStateError`)                    | The Page Object Tool cannot run now, and nothing ran. `<reason>` is its Availability Reason: `its Page Object is not on the page`; the runtime's `a click would not reach it; e42 is in the way`, naming the element a click would hit instead of the Page Object Root; or the string of the action's [availability predicate](ayme.md#action-availability). Without a reason, the predicate returned `false`. |
| `The Ayme runtime already has an active owner.` (`RuntimeStateError`, `code: "active-owner"`)            | A second session started in the same document, or in the same Node process. Start Ayme once, at the app's root or in the server's entry point.                                                                                                                                                                                                                                                                 |
| `The imported page object has no compiler-derived Ayme metadata.` (`RuntimeStateError`)                  | The build plugin did not compile the model: it is not marked `@ayme`, or the plugin does not transform its file.                                                                                                                                                                                                                                                                                               |
| `Cannot publish the tool "<name>": another published tool already uses that name.` (`RuntimeStateError`) | Two tools, such as a Custom Tool and a Page Object Tool, share a name. `ayme.tools.list()` is empty, so no tool is published, and `ayme.tools.run` throws it until the clash is fixed.                                                                                                                                                                                                                         |
| `createDecisionEndpoint must run on the server.` (`RuntimeStateError`)                                   | `createDecisionEndpoint` was called where `document` exists, which would put your key in the browser.                                                                                                                                                                                                                                                                                                          |

Framework packages list their own errors in the Troubleshooting section of their page, such as [Vue](../frameworks/vue.md#troubleshooting). The build plugin's are in its [reference](build-plugin.md#errors), and `decisionEndpoint`'s in the [Decision Endpoint reference](decision-endpoint.md#decisionendpoint).
