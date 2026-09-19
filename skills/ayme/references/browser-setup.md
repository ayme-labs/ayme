# Browser setup

Ayme publishes Generated WebMCP Tools through `document.modelContext`. First
complete the package README's runtime setup and enable build-time publication.
Choose one route below.

## Native Chrome

Follow [Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp): open
`chrome://flags/#enable-webmcp-testing`, enable the flag, and relaunch Chrome.
Open the application and use the Model Context Tool Inspector linked in that
guide to discover and invoke a tool. The flag enables the browser API; a coding
agent still needs a client connection, such as the relay below.

## Local polyfill and MCP relay

Use the [WebMCP Local Relay README](https://github.com/WebMCP-org/npm-packages/tree/main/packages/webmcp-local-relay)
for the current runtime and client configuration. The polyfill supplies the
browser API; the relay connects that browser to a coding agent over MCP.

For a local experiment, load these scripts before the application's entry
module in its HTML entry point:

```html
<script src="https://cdn.jsdelivr.net/npm/@mcp-b/global@latest/dist/index.iife.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@latest/dist/browser/embed.js"></script>
```

`@mcp-b/global` supplies the MCP-B runtime including the polyfill. A native
browser already supplying the required API can use the relay script alone.
Keep these scripts in the local development setup. Once working, pin the
resolved versions for repeatable use.

Configure a project-local MCP server using the client's configuration format:

```json
{
  "mcpServers": {
    "webmcp-local-relay": {
      "command": "npx",
      "args": [
        "-y",
        "@mcp-b/webmcp-local-relay@latest",
        "--widget-origin",
        "http://localhost:5173"
      ]
    }
  }
}
```

Replace the origin with the actual dev server origin, including its port.
The MCP client starts this stdio server. Reload the app after starting the
connection. Use `webmcp_list_sources`, then `webmcp_list_tools`, and invoke the
returned action name with its advertised arguments. Confirm its visible effect
in the app. A direct Ayme call or page-state read alone does not check the relay.

If no source appears, check script loading, the relay process, and the allowed
origin. If the app is served from a non-local origin, such as a deployed
preview, Chrome 142 and later asks the user to allow local network access before
the page can reach the relay. Ask the user to allow it, then reload the app. If
the source has no tools, check publication status, POM registration,
and action decorators in the package READMEs. If the driver loaded after Ayme's
initial wait, retry publication using the framework integration's API.

WebMCP is evolving. If the runtime contract differs, consult the linked upstream
README and report the mismatch rather than patching browser globals.
