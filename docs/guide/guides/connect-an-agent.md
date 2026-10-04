# Connect an agent

How to try your app's tools from Claude Code or another MCP client through the WebMCP local relay.

## How the connection works

Ayme publishes its tools to the page through WebMCP, `document.modelContext`. A coding agent does not read the page directly: the [WebMCP local relay](https://github.com/WebMCP-org/npm-packages/tree/main/packages/webmcp-local-relay) is an MCP server on your computer that the agent starts, and a small script on the page connects the page's tools to it. Turn publication on first, as [Publish tools](publish-tools.md) shows.

To see what an agent experiences before setting up your own app, open the [Ayme playground](https://ayme-labs.github.io/ayme/) and choose **Try with your own coding agent**. It walks you through the same relay setup against a demo app.

## Give the page WebMCP

Chrome with the WebMCP flag supplies `document.modelContext` natively: open `chrome://flags/#enable-webmcp-testing`, enable the flag and relaunch, as [Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) describes. In any other browser, load a polyfill. For a local experiment, load these scripts before your app's entry module in its HTML:

```html
<script src="https://cdn.jsdelivr.net/npm/@mcp-b/global@latest/dist/index.iife.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@latest/dist/browser/embed.js"></script>
```

`@mcp-b/global` supplies the polyfill; a browser that already has WebMCP needs only the relay script. Keep them in your development setup, and pin the versions once it works.

If the scripts load after Ayme's initial wait, retry publication as [Publish tools](publish-tools.md#publication-status) describes.

## Add the relay to your agent

Add the relay as an MCP server in your client's configuration format, with your dev server's origin, port included:

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

The client starts the relay. Reload the app once the agent is connected.

## What the agent sees

The relay gives the agent `webmcp_list_sources` and `webmcp_list_tools`, and lets it call the tools the page publishes, the ones [Publish tools](publish-tools.md#what-gets-published) lists. A good first check is to ask the agent to list the page's tools, call one of your Page Object Tools, and confirm the effect in the app.

## When it does not connect

- No source appears: check that the scripts load, that the relay is running, and that its `--widget-origin` matches the page's origin.
- The app is served from a non-local origin, such as a deployed preview: Chrome 142 and later asks you to allow local network access before the page can reach the relay. Allow it and reload.
- The source has no tools: check the publication status, that your Page Objects are registered, and that their actions are marked.
