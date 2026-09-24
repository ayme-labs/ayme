# Reporting tool execution failures through WebMCP

Research for #50 "Tool execution failures lose the underlying browser error". Question: what is the standard-conformant way for a tool published through `document.modelContext` to report an execution failure, and is there a standard structured error shape?

Sources were read on 2026-09-24. GitHub links are pinned to the commit that was read. "Authority" marks each source as a **spec** (normative text of a released revision), a **draft** (a Community Group draft or an open proposal), an **implementation** (shipping code), or **docs/practice** (guidance or common usage, not normative).

## Facts

1. The current MCP revision is `2026-07-28`, status **Current** ([versioning](https://modelcontextprotocol.io/specification/versioning): "The **current** protocol version is **2026-07-28**"). Authority: spec.
2. MCP has two error mechanisms. Tool execution errors "are reported in tool results with `isError: true`"; protocol errors are JSON-RPC errors for an unknown tool, a malformed request, or a server error ([tools.mdx L738-L785](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/0cb6c6a31768cbb16129b35e6b569a31fecfe1b6/docs/specification/2026-07-28/server/tools.mdx#L738-L785)). Authority: spec.
3. The schema says: "Any errors that originate from the tool SHOULD be reported inside the result object, with `isError` set to true, _not_ as an MCP protocol-level error response." ([schema.ts L1823-L1837](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/271ecc9accafdd9b83a3c869fa67c22953b2af80/schema/2026-07-28/schema.ts#L1823-L1837)). Authority: spec.
4. The only error example in the spec is text-only: `content: [{ type: "text", text: "Invalid departure date: …" }], isError: true` ([tools.mdx L765-L781](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/0cb6c6a31768cbb16129b35e6b569a31fecfe1b6/docs/specification/2026-07-28/server/tools.mdx#L765-L781)). The spec defines no error object, code, or text prefix. Authority: spec.
5. The spec does not say whether `structuredContent` may or must appear when `isError` is true. It says `structuredContent` "conforms to the tool's `outputSchema` if one is defined", and, if an output schema is provided, "Servers **MUST** provide structured results that conform to this schema." ([tools.mdx L498, L514](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/0cb6c6a31768cbb16129b35e6b569a31fecfe1b6/docs/specification/2026-07-28/server/tools.mdx#L496-L515)). The gap is open as [modelcontextprotocol#3003](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3003). Authority: spec (silence) plus an open issue.
6. The official TypeScript SDK (`@modelcontextprotocol/server` 2.0.0, which `@mcp-b/webmcp-types` depends on) converts a thrown handler error into `{ content: [{ type: "text", text: error.message }], isError: true }`, and skips output-schema validation when `result.isError` is set (`node_modules/.pnpm/@modelcontextprotocol+server@2.0.0/.../dist/mcp-DXXb3Vv3.mjs` L1398-L1445). Authority: implementation.
7. In the WebMCP draft, `execute` is `callback ToolExecuteCallback = Promise<any> (…)` ([index.bs L1105](https://github.com/webmachinelearning/webmcp/blob/f5645e9aea51eb589599f181d104a2f49430608e/index.bs#L1105)). A fulfilled value is JSON-serialized and returned as a success. On rejection the reason `r` is used only to "Optionally report a warning to the console" ([index.bs L516-L547](https://github.com/webmachinelearning/webmcp/blob/f5645e9aea51eb589599f181d104a2f49430608e/index.bs#L516-L547)). `executeTool()` then rejects with an `"UnknownError"` `DOMException` ([index.bs L1044-L1046](https://github.com/webmachinelearning/webmcp/blob/f5645e9aea51eb589599f181d104a2f49430608e/index.bs#L1019-L1046)). Authority: draft (CG-DRAFT).
8. The WebMCP draft specifies the `UnknownError` name but no message. The text "Tool was executed but the invocation failed. For example, the script function threw an error" comes from Chromium's `GetToolErrorMessage` ([model_context.cc L193-L196](https://github.com/chromium/chromium/blob/4ba301ad8c7c1e2190707d80aec6bc8aa63a2671/third_party/blink/renderer/core/script_tools/model_context.cc#L177-L205)). Authority: implementation.
9. The WebMCP draft does not mention `isError`, `CallToolResult`, `structuredContent`, or `outputSchema` (0 matches in `index.bs` at f5645e9). An object with `isError: true` is an ordinary successful return value: the browser serializes it as JSON and resolves `executeTool()` with that string. Authority: draft.
10. `outputSchema` for WebMCP is only proposed, in the open [webmcp PR #254](https://github.com/webmachinelearning/webmcp/pull/254) (fixes [#9](https://github.com/webmachinelearning/webmcp/issues/9)). The PR serializes the schema and exposes it on `RegisteredTool`. It adds no validation of results. Authority: draft proposal.
11. Chrome's shipping `ModelContextTool` IDL has no `outputSchema` member ([model_context_tool.idl](https://github.com/chromium/chromium/blob/4ba301ad8c7c1e2190707d80aec6bc8aa63a2671/third_party/blink/renderer/core/script_tools/model_context_tool.idl)). Authority: implementation.
12. The WebMCP explainer's guidance is to "return clear, actionable error messages so the agent can self-correct" and, when an action fails, to "return an informative error message" ([README L452-L453](https://github.com/webmachinelearning/webmcp/blob/50c4b7fd6c4402731271649bc544b662b061ed44/README.md#L450-L453)). Authority: explainer (non-normative).
13. `@mcp-b/webmcp-polyfill` 5.1.0 rethrows a tool's failure as ``DOMException(`${TOOL_INVOCATION_FAILED_MESSAGE}: ${error.message}`, "UnknownError")``. It keeps the message only, and only when the thrown value is an `Error` (`dist/schema.js` L93-L95, `dist/index.js` L802-L818). Authority: implementation.
14. The standard `ModelContextTool.execute` in `@mcp-b/webmcp-types` 5.x returns `MaybePromise<TResult>` with `TResult = unknown`. `CallToolResult` is re-exported from `@modelcontextprotocol/server`, and the package defines no error type (`dist/tool.d.ts` L19-L26, `dist/common.d.ts` L1). Authority: implementation (types).
15. In practice (not standard), the Python SDK (`"Error executing tool {name}: {exc}"`) and `mcp-go` (`NewToolResultError*`) produce text-only `isError` results. None of the SDKs or servers surveyed puts an error object in `structuredContent` (§4). Authority: practice.

## 1. MCP specification

**Revision.** `2026-07-28` is the current revision ([versioning](https://modelcontextprotocol.io/specification/versioning)). The `draft` tools page has the same error-handling text as `2026-07-28`: the diff shows only link-path changes. `2025-11-25` has the same two-mechanism model in different wording ([2025-11-25 tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling)). Authority: spec.

**Protocol errors vs tool execution errors.** From [tools.mdx L740-L785](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/0cb6c6a31768cbb16129b35e6b569a31fecfe1b6/docs/specification/2026-07-28/server/tools.mdx#L738-L785):

- Protocol errors "indicate issues with the request structure itself that models are less likely to be able to fix": unknown tool, malformed request, server errors. They are "returned as standard JSON-RPC errors".
- Tool execution errors "contain actionable feedback that language models can use to self-correct and retry with adjusted parameters": API failures, input validation errors, business logic errors. "They are reported in tool results with `isError: true`".
- "Clients **SHOULD** provide tool execution errors to language models to enable self-correction." Clients only **MAY** pass protocol errors to the model.

**`isError`.** The `CallToolResult.isError` doc comment ([schema.ts L1823-L1837](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/271ecc9accafdd9b83a3c869fa67c22953b2af80/schema/2026-07-28/schema.ts#L1809-L1838)):

- "If not set, this is assumed to be false (the call was successful)."
- Tool-originated errors "SHOULD be reported inside the result object, with `isError` set to true, _not_ as an MCP protocol-level error response. Otherwise, the LLM would not be able to see that an error occurred and self-correct."
- "any errors in _finding_ the tool, an error indicating that the server does not support tool calls, or any other exceptional conditions, should be reported as an MCP error response."

`content: ContentBlock[]` is required on every `CallToolResult`, including error results. The spec gives no rule for error text beyond the example in Fact 4. The canonical example file is the same text-only shape ([invalid-tool-input-error.json](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/examples/CallToolResult/invalid-tool-input-error.json)).

**`structuredContent` and `outputSchema`.** From [tools.mdx L496-L515](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/0cb6c6a31768cbb16129b35e6b569a31fecfe1b6/docs/specification/2026-07-28/server/tools.mdx#L496-L515):

- `structuredContent` "can be any JSON value … that conforms to the tool's `outputSchema` if one is defined."
- "For backwards compatibility, a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block."
- If an output schema is provided: "Servers **MUST** provide structured results that conform to this schema." and "Clients **SHOULD** validate structured results against this schema."
- `outputSchema` is optional on `Tool` ([schema.ts L2000-L2005](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/271ecc9accafdd9b83a3c869fa67c22953b2af80/schema/2026-07-28/schema.ts#L2000-L2005)).

The spec neither allows nor forbids `structuredContent` on an `isError: true` result, and it defines no error-object convention. The "MUST conform" rule has no carve-out for error results. Read literally, a server that declares an `outputSchema` and returns non-conforming `structuredContent` with `isError: true` breaks the MUST. Omitting `structuredContent` on an error result is also not explicitly exempted. That is an inference from the spec's silence, not a quoted rule.

**Open spec work (draft, non-normative).**

- [modelcontextprotocol#3003](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3003) (open, 2026-07-02), "Tool Execution Errors lack a schema-governed signal … structuredContent should be defined for error path". It asks: "Is `structuredContent` intentionally excluded from the error path, or is this a gap?" There is no maintainer resolution in the thread as read.
- [modelcontextprotocol PR #2145](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2145) "SEP-2145: Standardize `tools/call` failure reporting" (open) would report unknown-tool and output-validation failures ("missing or non-conforming `structuredContent` when `outputSchema` is declared") as tool execution errors. It states this "Aligns specification with existing Python and TypeScript SDK behavior".

**TypeScript SDK conventions (implementation).** Installed `@modelcontextprotocol/server` 2.0.0, file `node_modules/.pnpm/@modelcontextprotocol+server@2.0.0/node_modules/@modelcontextprotocol/server/dist/mcp-DXXb3Vv3.mjs`:

- L1398-L1407: the `tools/call` handler runs input validation, the handler, and output validation inside one `try`. Any error except `UrlElicitationRequired` becomes `this.createToolError(error instanceof Error ? error.message : String(error))`.
- L1417-L1425: `createToolError` returns `{ content: [{ type: "text", text: errorMessage }], isError: true }`. Only the message survives. No name, cause, or `structuredContent` is included.
- L1438-L1445: `validateToolOutput` returns early `if (result.isError)`. Output-schema validation therefore applies only to success results. Missing or invalid `structuredContent` on a success result throws `Output validation error: …`, which the catch above turns into an `isError` result.
- The core schema is `CallToolResultSchema = { content: ContentBlock[] (default []), structuredContent?: unknown, isError?: boolean }` (`@modelcontextprotocol+core@2.0.0/.../dist/auth-CUe6YdwF.mjs` L759-L763).

So in the TS SDK a handler may simply throw. The SDK does the MCP-conformant conversion to a text `isError` result and exempts error results from `outputSchema`.

## 2. WebMCP (W3C Web Machine Learning CG) and Chrome

**Status.** `index.bs` header: `Status: CG-DRAFT`, `Group: webml`. The spec was read at commit [f5645e9](https://github.com/webmachinelearning/webmcp/blob/f5645e9aea51eb589599f181d104a2f49430608e/index.bs) (2026-09-17). Authority: draft. A CG draft is not a W3C Recommendation, and its normative algorithms may change.

**What `execute` may return.** `callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);` ([L1105](https://github.com/webmachinelearning/webmcp/blob/f5645e9aea51eb589599f181d104a2f49430608e/index.bs#L1105)). Any value is accepted. The spec does not require an MCP `CallToolResult`. The explainer shows both a `{ content: [{ type: "text", … }] }` return ([README L291-L300](https://github.com/webmachinelearning/webmcp/blob/50c4b7fd6c4402731271649bc544b662b061ed44/README.md#L281-L300)) and a plain object `return { office: "Building 4" }` ([README L345](https://github.com/webmachinelearning/webmcp/blob/50c4b7fd6c4402731271649bc544b662b061ed44/README.md#L345)).

**Fulfilled vs rejected** (imperative execute steps, [L516-L547](https://github.com/webmachinelearning/webmcp/blob/f5645e9aea51eb589599f181d104a2f49430608e/index.bs#L511-L547)):

- Fulfilled with `v`: "Let |serializedResult| be the result of serializing a JavaScript value to a JSON string given |v|", then `completionSteps(serializedResult, true)`. A serialization failure takes the failure path.
- Rejected with `r`: "Optionally report a warning to the console describing |r|", then `completionSteps(null, false)`. The reason `r` goes nowhere else.
- `executeTool()` completion ([L1019-L1046](https://github.com/webmachinelearning/webmcp/blob/f5645e9aea51eb589599f181d104a2f49430608e/index.bs#L1019-L1046)): on success it resolves the promise with the string. Otherwise it rejects "with an "UnknownError" DOMException". The IDL return type is `Promise<DOMString>`.
- The spec marks this as unfinished: "Issue: Support more granular errors than "UnknownError", based on each failure case." (L987, L997, L1008, L1017). Also "Issue: Support the plumbing of more granular errors back to the invoker" (L426).

The generic `UnknownError` **name** is specified. The **message** is not: the spec names only the exception type. Dropping the rejection reason is specified (draft) behavior, not a Chrome bug.

`isError` has no meaning in WebMCP. A `{ content, isError: true }` return is a successful fulfillment whose JSON the caller receives verbatim. Whether anything reads `isError` depends on the caller, for example an MCP bridge that treats the string as a `CallToolResult` (see Open questions).

**Chrome implementation** (Chromium [model_context.cc @ 4ba301a](https://github.com/chromium/chromium/blob/4ba301ad8c7c1e2190707d80aec6bc8aa63a2671/third_party/blink/renderer/core/script_tools/model_context.cc), 2026-09-18). Authority: implementation.

- L256-L290 (`ToolFunctionFinishedCallback::React`, success path): objects go through `v8::JSON::Stringify`. Non-objects use `ToString`. An empty result becomes `"Operation succeeded"`. The spec says to JSON-serialize every value, so Chrome deviates for primitives: a string return is passed through unquoted.
- L296-L316 (`HandleFailure`): logs the console error `"WebMCP tool execution failed: " + message_text` (the spec's optional console report), then reports failure.
- L855-L871 (`OnToolExecuted`): a rejected execution becomes `ScriptToolError(ScriptToolErrorCode::kToolInvocationFailed)`. The rejection value is passed only to the DevTools probe `probe::WebMCPToolFailed`.
- L177-L205 (`GetToolErrorMessage`): `kToolInvocationFailed` maps to "Tool was executed but the invocation failed. For example, the script function threw an error".
- L1197-L1217 (`OnExecuteScriptToolCompleted`): `resolver->RejectWithDOMException(DOMExceptionCode::kUnknownError, result)`, under "TODO(https://crbug.com/509555636): Support more granular execution error reasons."
- [model_context_tool.idl](https://github.com/chromium/chromium/blob/4ba301ad8c7c1e2190707d80aec6bc8aa63a2671/third_party/blink/renderer/core/script_tools/model_context_tool.idl): `ModelContextTool` has `name`, `title`, `description`, `inputSchema`, `execute`, and `annotations`. It has no `outputSchema`.

**Chrome documentation** (docs, non-normative):

- [Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) (updated 2026-09-21): `executeTool` "returns the result of the tool execution, or null when a navigation is triggered". Its examples return plain strings. The page says nothing on errors, `isError`, or `outputSchema`.
- [Build tools](https://developer.chrome.com/docs/ai/webmcp/build-tools) (updated 2026-08-26), section "Fail gracefully and enable recovery": "Always provide context-aware feedback to help the agent recover; avoid returning generic error messages, raw API errors, or failing silently." Its examples are text messages, such as "Invalid date format. Provide the date in YYYY-MM-DD format."
- [Best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices) (updated 2026-05-18): "If a tool is rate limited, return a meaningful error".
- [chromestatus WebMCP (5117755740913664)](https://chromestatus.com/feature/5117755740913664): no text on result or error shape.

The Chrome docs consistently say to _return_ the error text. They never say to throw.

**`outputSchema` / `structuredContent` in WebMCP.**

- Not in the draft.
- [PR #254](https://github.com/webmachinelearning/webmcp/pull/254) "Add `outputSchema` to `ModelContextTool` and `RegisteredTool`" (open, 2026-08-21, by a spec editor) serializes the schema at registration and exposes it through `getTools()`. It adds no step that validates results against it. Authority: draft proposal.
- `structuredContent` does not appear in the draft or in the PR.

**Related open WebMCP issues** (draft discussion, non-normative):

- [#282](https://github.com/webmachinelearning/webmcp/issues/282) "No structured way to signal a tool's refusal, distinct from success or a schema-validation error".
- [#308](https://github.com/webmachinelearning/webmcp/issues/308) "Preserve what a tool already produced across the execution boundary". It proposes not discarding the rejection reason. The envelope shape is left open.
- [#86](https://github.com/webmachinelearning/webmcp/issues/86) "Proposal: Tool result content types beyond text".

Commenters on #282 report returning ordinary results that carry their own error envelope, because a throw reaches the caller as a bare `UnknownError`. No shape has group agreement.

## 3. `@mcp-b/webmcp-types` and `@mcp-b/webmcp-polyfill`

**Versions.** `packages/webmcp` resolves `@mcp-b/webmcp-types` 5.0.1 (`pnpm-lock.yaml`, `packages/webmcp` importer). The polyfill 5.1.0 depends on types 5.1.0. The `dist/` folders of 5.0.1 and 5.1.0 are identical (`diff -r` shows no differences). Paths below are under `node_modules/.pnpm/@mcp-b+webmcp-types@5.1.0/node_modules/@mcp-b/webmcp-types/`. Authority: implementation (types).

- `dist/tool.d.ts` L19-L26, `ModelContextTool` (the standard dictionary, used by ayme): `execute: (input: TArgs) => MaybePromise<TResult>` with `TResult = unknown`. It has no `outputSchema`. Annotations are `readOnlyHint` and `untrustedContentHint`.
- `dist/tool.d.ts` L32-L35, `ToolDescriptor` (the MCP-B extension): `ModelContextTool` plus `outputSchema?: JsonSchemaForInference` and MCP `ToolAnnotations`.
- `dist/tool.d.ts` L37-L42: `ToolResultFromOutputSchema<O>` is `Omit<CallToolResult, 'structuredContent'> & { structuredContent: InferJsonSchema<O> }`. `ExecuteResult<O>` is `InferJsonSchema<O> | ToolResultFromOutputSchema<O>`. When a tool is typed with `ToolDescriptorFromSchema` and an `outputSchema`, its `CallToolResult` arm _requires_ `structuredContent` typed by the schema, including on `isError: true` results. The types have no error-result exemption, unlike the TS SDK runtime.
- `dist/common.d.ts` L1: `CallToolResult`, `ContentBlock`, and `TextContent` are re-exported from `@modelcontextprotocol/server`. The package defines no error-related type.
- `README.md` L97: "`outputSchema` is not part of the current standard `ModelContextTool` dictionary."
- `dist/model-context.d.ts` L41-L43: Chromium's `executeTool(...)` returns `Promise<string | null>`.

**Polyfill 5.1.0** (`node_modules/.pnpm/@mcp-b+webmcp-polyfill@5.1.0/node_modules/@mcp-b/webmcp-polyfill/dist/`). Authority: implementation.

- `schema.js` L7: `TOOL_INVOCATION_FAILED_MESSAGE = "Tool was executed but the invocation failed. For example, the script function threw an error"`. This is Chrome's string.
- `schema.js` L93-L95, `createToolInvocationFailedError(error)`: returns ``new DOMException(`${TOOL_INVOCATION_FAILED_MESSAGE}: ${error.message}`, "UnknownError")`` when `error instanceof Error`, and the bare message otherwise. The name, `cause`, stack, and custom properties are lost.
- `index.js` L802-L818, `#invokeToolByName`: calls `tool.execute(args)`. Abort and unregistration rethrow their own reasons. Any other rejection becomes `throw createToolInvocationFailedError(error)`. A fulfilled value goes to `serializeChromeToolResult` (`schema.js` L118-L124), which JSON-stringifies objects, uses `String(value)` otherwise, and falls back to `"Operation succeeded"`. It does not inspect `isError`.
- `schema.js` L67-L89: `normalizeToolResponse` passes through anything with an array `content` as-is. Otherwise it wraps the value into `{ content: [text], structuredContent?, isError: false }`. This helper is exported but not used on the `executeTool` path in `index.js`.
- `coerceWebMcpToolDescriptor` (`schema.js` L17-L44) keeps an `outputSchema` member. `index.js` never reads `outputSchema` (0 matches), so the polyfill does not validate results.

## 4. Practice (not standard)

- **TS SDK** (see §1): a thrown error becomes `text: error.message`, `isError: true`. No prefix is added.
- **Python SDK** ([mcpserver/tools/base.py L199-L210 @ f1b6589](https://github.com/modelcontextprotocol/python-sdk/blob/f1b6589088534632fef92238ee9750951e3c0185/src/mcp/server/mcpserver/tools/base.py#L191-L210), [server.py L447](https://github.com/modelcontextprotocol/python-sdk/blob/f1b6589088534632fef92238ee9750951e3c0185/src/mcp/server/mcpserver/server.py#L440-L447)):
  - A deliberate `ToolError` becomes `"Error executing tool {name}: {exc}"`.
  - An unexpected exception becomes `"Error executing tool {name}"` with the message withheld: "A crash: the exception's own text stays on the server."
  - The result is `CallToolResult(content=[TextContent(type="text", text=str(exc))], is_error=True)`.
  - `MCPError` is re-raised as a JSON-RPC protocol error.
- **mcp-go** ([mcp/utils.go L418-L461 @ d74db50](https://github.com/mark3labs/mcp-go/blob/d74db509452d46e0521fe43b9e3dfa77350e8b0a/mcp/utils.go#L418-L461)): `NewToolResultError(text)`, `NewToolResultErrorf`, and `NewToolResultErrorFromErr(text, err)` (which gives `"text: err"`). All three are single-text-block, `IsError: true`. There is no structured error helper.
- **Reference filesystem server** ([src/filesystem/index.ts @ 18ce197](https://github.com/modelcontextprotocol/servers/blob/18ce19763999dcf7697b00c86c3a427f01eb2919/src/filesystem/index.ts)): declares `outputSchema` on its tools and returns `structuredContent` on success. For failures it throws (for example L196 `throw new Error("Cannot specify both head and tail parameters simultaneously")`) and relies on the SDK to turn the throw into a text `isError` result. It uses no `structuredContent` for errors.
- **WebMCP local relay** (the MCP bridge used by the playground; [mcpRelayServer.ts L478-L496 @ de0b41c](https://github.com/WebMCP-org/npm-packages/blob/de0b41cf92d98490807bc09673a1541e3987b049/packages/webmcp-local-relay/src/mcpRelayServer.ts#L478-L496)): returns the bridge's tool result as the MCP result. If the invocation throws, it returns ``{ content: [{ type: "text", text: `Failed to invoke relayed tool "${name}": ${message}` }], isError: true }``.
- Text conventions vary: a bare message (TS SDK), an `Error executing tool …:` prefix (Python), or a caller-chosen prefix (Go, relay). Nothing surveyed puts an error object in `structuredContent`.
- Structured error envelopes appear only in proposals: MCP #3003, and WebMCP #282 and #308 comments.

## 5. Options for ayme

These are facts and trade-offs only. No option is chosen here.

**(a) Return `{ content: [{ type: "text", text }], isError: true }` from the published `execute`.**

Conformance:

- MCP: matches the spec's tool-execution-error mechanism and its only example (Facts 2-4).
- WebMCP draft: a valid `Promise<any>` fulfillment.
- Chrome and polyfill: reaches the caller as a JSON string (#50 confirms this on native Chrome).

Trade-offs:

- `executeTool()` _resolves_. WebMCP-level callers that only check for rejection will treat the call as a success unless they parse the result and read `isError`. `isError` is an MCP convention, not a WebMCP one (Fact 9).
- Classification (browser action vs ref resolution vs input validation) must be encoded in text.
- MCP clients SHOULD forward the text to the model (tools.mdx L785).

**(b) Option (a) plus `structuredContent` carrying an error object** (for example `{ error: { name, message, kind, cause? } }`).

Conformance:

- MCP: neither allowed nor forbidden (Fact 5). No standard error schema exists. Any shape is ayme-specific.
- If the tool declares an `outputSchema`, the spec's "MUST conform" rule has no error exemption. A conforming design would make the error object part of the schema, for example a `oneOf` of the success shape and the error shape. The TS SDK does not validate `isError` results (§1). A strict client that applies "Clients SHOULD validate structured results" without an exemption could flag an error object that does not match the schema.
- If the tool declares no `outputSchema`: MCP permits `structuredContent` with any JSON value. The only rule is that structured content SHOULD also be serialized into a text block (tools.mdx L500).
- WebMCP: `outputSchema` does not exist in the draft or in Chrome (Facts 10-11). ayme publishes the standard `ModelContextTool` (`packages/webmcp/src/*.ts` import `ModelContextTool`). Declaring `outputSchema` would therefore depend on the MCP-B `ToolDescriptor` extension or on PR #254 landing. So adding `structuredContent` does **not** require an `outputSchema` on every tool.
- Types: with `ToolDescriptorFromSchema` plus `outputSchema`, `@mcp-b/webmcp-types` requires schema-typed `structuredContent` on every `CallToolResult` return, errors included (§3).

Trade-offs:

- Agents get machine-readable classification. In exchange, ayme owns a public error contract that no standard backs.
- MCP #3003 and WebMCP #282 and #308 may later standardize a different shape.

**(c) Other options the sources suggest.**

- _Keep throwing._ This follows the WebMCP draft's rejection path. Today it loses the reason by specification (Fact 7). The polyfill keeps only the message (Fact 13). WebMCP #308 would change this if adopted. Throwing is also the correct channel in MCP terms only for protocol-level failures (Fact 3).
- _Split by failure class, as MCP does._ Report tool-originated failures (browser action, ref resolution, business rules, and input validation, which MCP classes as a tool execution error) as `isError` results. Keep rejections for conditions the spec treats as exceptional.
- _Withhold internal detail._ The Python SDK hides unexpected-exception text from the model, and Chrome docs advise against "raw API errors". This bears on #50's question about including Playwright Lite call logs. It is practice, not a rule.
- _Wait for or contribute to the specs._ MCP #3003 and PR #2145 would define error-path structure and output-validation behavior. WebMCP #308 would define reason preservation, and #254 `outputSchema`.

## Open questions

1. How does the WebMCP local relay's browser side read a page tool's result? Does it parse the `executeTool()` JSON string as a `CallToolResult`, so that `isError` reaches the MCP client as `isError`, or does it wrap the string as text? §4 covers only the relay's MCP-server side. Needs a read of the relay's `browser/` sources or an end-to-end check.
2. Do the browser agents that call `document.modelContext.executeTool()` (Chrome's built-in agent, extensions) interpret `isError` in the returned JSON? No Chrome doc says so.
3. Will the MCP maintainers resolve #3003 by allowing, forbidding, or standardizing `structuredContent` on error results? Would SEP-2145 (PR #2145) settle output-validation behavior for `isError` results?
4. Will WebMCP #308 or a successor change the rejection path to carry the reason? That would make throwing viable. Will PR #254 add result validation?
5. Chrome returns non-object values unquoted, while the draft JSON-serializes every value (§2). This matters if ayme returns plain strings.

## Sources

- MCP versioning: https://modelcontextprotocol.io/specification/versioning (spec)
- MCP tools, 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/server/tools ; source https://github.com/modelcontextprotocol/modelcontextprotocol/blob/0cb6c6a31768cbb16129b35e6b569a31fecfe1b6/docs/specification/2026-07-28/server/tools.mdx (spec)
- MCP schema, 2026-07-28: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/271ecc9accafdd9b83a3c869fa67c22953b2af80/schema/2026-07-28/schema.ts (spec)
- MCP tools, 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/server/tools (spec, final)
- MCP issue #3003: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3003 (open issue)
- MCP PR #2145 (SEP-2145): https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2145 (proposal)
- `@modelcontextprotocol/server` 2.0.0 and `@modelcontextprotocol/core` 2.0.0, installed under `node_modules/.pnpm/` (implementation)
- MCP Python SDK @ f1b6589: https://github.com/modelcontextprotocol/python-sdk/tree/f1b6589088534632fef92238ee9750951e3c0185 (implementation)
- mcp-go @ d74db50: https://github.com/mark3labs/mcp-go/blob/d74db509452d46e0521fe43b9e3dfa77350e8b0a/mcp/utils.go (implementation)
- MCP reference servers @ 18ce197: https://github.com/modelcontextprotocol/servers/blob/18ce19763999dcf7697b00c86c3a427f01eb2919/src/filesystem/index.ts (practice)
- WebMCP draft @ f5645e9: https://github.com/webmachinelearning/webmcp/blob/f5645e9aea51eb589599f181d104a2f49430608e/index.bs ; rendered https://webmachinelearning.github.io/webmcp/ (CG draft)
- WebMCP explainer @ 50c4b7f: https://github.com/webmachinelearning/webmcp/blob/50c4b7fd6c4402731271649bc544b662b061ed44/README.md (explainer)
- WebMCP #9, #86, #282, #308, PR #254: https://github.com/webmachinelearning/webmcp/issues/9 , https://github.com/webmachinelearning/webmcp/issues/86 , https://github.com/webmachinelearning/webmcp/issues/282 , https://github.com/webmachinelearning/webmcp/issues/308 , https://github.com/webmachinelearning/webmcp/pull/254 (draft discussion)
- Chromium `script_tools` @ 4ba301a: https://github.com/chromium/chromium/tree/4ba301ad8c7c1e2190707d80aec6bc8aa63a2671/third_party/blink/renderer/core/script_tools (implementation)
- Chrome for Developers, WebMCP: https://developer.chrome.com/docs/ai/webmcp/imperative-api , https://developer.chrome.com/docs/ai/webmcp/build-tools , https://developer.chrome.com/docs/ai/webmcp/best-practices (docs)
- chromestatus WebMCP: https://chromestatus.com/feature/5117755740913664 (docs)
- `@mcp-b/webmcp-types` 5.0.1 and 5.1.0, `@mcp-b/webmcp-polyfill` 5.1.0, installed under `node_modules/.pnpm/` (implementation)
- WebMCP local relay @ de0b41c: https://github.com/WebMCP-org/npm-packages/blob/de0b41cf92d98490807bc09673a1541e3987b049/packages/webmcp-local-relay/src/mcpRelayServer.ts (implementation)
- ayme #50: https://github.com/ayme-labs/ayme/issues/50
