// The document of a Session's Inspector, in a browser window or in an Agent
// App's chat.

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/**
 * The Inspector's document for the Session named `name`, around `body`. Its
 * `ayme-session` meta tells the Inspector's script that a Session serves
 * it, which no agent reaches through the Agent Connection or WebMCP.
 */
export const inspectorDocument = (name: string, body: string): string =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="ayme-session" content="${escapeHtml(name)}" />
    <title>ayme inspect: ${escapeHtml(name)}</title>
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
      }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>
`;
