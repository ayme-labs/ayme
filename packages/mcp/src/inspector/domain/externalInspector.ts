/** Where the server serves the external Inspector's page. */
export const INSPECTOR_PATH = "/inspector";

/** The script of the external Inspector's page, which the server serves beside it. */
export const INSPECTOR_SCRIPT_PATH = "/inspector/external.mjs";

/** The WebSocket path an external Inspector window connects to. */
export const INSPECTOR_SOCKET_PATH = "/inspector/ws";

/** The package that holds the external Inspector's build, an optional peer. */
export const INSPECTOR_PACKAGE = "@ayme-dev/inspector";

export function inspectorUrl(host: string, port: number): string {
  return `http://${host}:${port}${INSPECTOR_PATH}`;
}

/** The address of the page an Agent App shows in its chat (MCP Apps). */
export const INSPECTOR_APP_URI = "ui://ayme/inspector.html";

/**
 * The socket URL a window from another origin connects to: the socket of the
 * server on `port`, with the token that admits it.
 */
export function inspectorSocketUrl(
  host: string,
  port: number,
  token: string
): string {
  return `ws://${host}:${port}${INSPECTOR_SOCKET_PATH}?token=${encodeURIComponent(token)}`;
}

/** What to do when the Inspector's package is not installed. */
export const INSPECTOR_INSTALL_HINT = `The external Inspector needs the optional package ${INSPECTOR_PACKAGE}. Install it in the project that runs \`ayme\`, for example \`npm install --save-dev ${INSPECTOR_PACKAGE}\`.`;

/** The external Inspector's document, around `body`. */
const inspectorDocument = (body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ayme Inspector</title>
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

/** The page that loads the external Inspector's script. */
export const INSPECTOR_HTML = inspectorDocument(
  `<script type="module" src="${INSPECTOR_SCRIPT_PATH}"></script>`
);

/**
 * The id of the element that gives the page an Agent App shows the socket
 * it connects to, as JSON `{ "socket": url }`. The Inspector's external
 * build reads it, and, finding it, talks to the Agent App it is shown in.
 */
export const INSPECTOR_APP_CONFIG_ID = "ayme-inspector-app";

/**
 * The page an Agent App shows in its chat (MCP Apps): the external
 * Inspector's document with `build`, its script, inside it, since Agent Apps
 * load no script from elsewhere, and the socket URL it connects to, since its
 * own address is the Agent App's. Without a build, the install hint.
 */
export function inspectorAppHtml(
  build: string | undefined,
  socketUrl: string
): string {
  if (build === undefined)
    return inspectorDocument(`<p>${INSPECTOR_INSTALL_HINT}</p>`);
  const config = JSON.stringify({ socket: socketUrl });
  return inspectorDocument(
    `<script type="application/json" id="${INSPECTOR_APP_CONFIG_ID}">${inline(config)}</script>
    <script type="module">${inline(build)}</script>`
  );
}

/**
 * Script text that stays inside its `<script>` element: the HTML parser
 * would end the element at `</script` and change how it reads after
 * `<!--`. Both are escaped as JavaScript and JSON read them the same, in a
 * string, a template, a regular expression or a comment.
 */
function inline(script: string) {
  return script.replace(/<(\/script|!--)/gi, "\\u003C$1");
}
