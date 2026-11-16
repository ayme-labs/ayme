/** Where the server serves the external Inspector's page. */
export const INSPECTOR_PATH = "/inspector";

/** The script of the external Inspector's page, which the server serves beside it. */
export const INSPECTOR_SCRIPT_PATH = "/inspector/external.mjs";

/** The WebSocket path an external Inspector window connects to. */
export const INSPECTOR_SOCKET_PATH = "/inspector/ws";

/** The package that holds the external Inspector's build, an optional peer. */
export const INSPECTOR_PACKAGE = "@ayme-dev/inspector";

/** The URL of the external Inspector the server on `port` serves. */
export function inspectorUrl(host: string, port: number): string {
  return `http://${host}:${port}${INSPECTOR_PATH}`;
}

/** What to do when the Inspector's package is not installed. */
export const INSPECTOR_INSTALL_HINT = `The external Inspector needs the optional package ${INSPECTOR_PACKAGE}. Install it in the project that runs \`ayme\`, for example \`npm install --save-dev ${INSPECTOR_PACKAGE}\`.`;

/** The page that loads the external Inspector's script. */
export const INSPECTOR_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ayme Inspector</title>
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <script type="module" src="${INSPECTOR_SCRIPT_PATH}"></script>
  </body>
</html>
`;
