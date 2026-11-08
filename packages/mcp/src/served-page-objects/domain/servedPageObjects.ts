/** The folder of a project that holds what `ayme mcp` serves and writes. */
export const AYME_FOLDER = ".ayme";

/**
 * The entry `ayme mcp` looks for in the folder it starts in: a module whose
 * default export is the Page Object classes to register, the shape of
 * `createAyme`'s `pageObjects` option.
 */
export const ENTRY_FILE = `${AYME_FOLDER}/page-objects.ts`;

/** The init script `ayme mcp` writes into {@link AYME_FOLDER}. */
export const INIT_SCRIPT_FILE = "init-script.js";

/** Where the server's HTTP server serves the built modules. */
export const SERVED_PATH = "/page-objects/";

/** Where it streams the stamp of each good build to a page. */
export const EVENTS_PATH = `${SERVED_PATH}events`;

/** The built module that re-exports the project's own `@ayme-dev/ayme`. */
export const RUNTIME_MODULE = "runtime.js";

/** The built module of the entry, whose default export is the classes. */
export const ENTRY_MODULE = "entry.js";

/**
 * The init script for the browser automation: in every top-level http(s)
 * document, it imports the runtime and the entry the server on `port`
 * serves, starts the runtime with the Agent Connection on and registers the
 * entry's classes, with the Inspector in a window of its own, which the
 * page serves only once `ayme_inspect`'s URL is opened. It then follows the
 * server's build stamps: after a rebuild of the entry it imports the new
 * entry and swaps its classes in for the old ones, and after a rebuild of
 * the runtime, which it cannot swap, it reloads the page. A frame or a
 * document such as `about:blank` loads nothing, so only the tab pairs, and
 * neither does a page of `ayme mcp`'s own, such as the Inspector's window.
 * It is a classic script, as an init script runs.
 */
export function initScript(port: number): string {
  const served = `http://127.0.0.1:${port}${SERVED_PATH}`;
  const events = `http://127.0.0.1:${port}${EVENTS_PATH}`;
  return `// Written by ayme mcp (experimental) when it started on port ${port}.
// It loads the Page Objects that ayme mcp serves into each page, and swaps
// in their new build after each edit.
(() => {
  const served = ${JSON.stringify(served)};
  if (
    window.top !== window ||
    !/^https?:$/.test(location.protocol) ||
    location.origin === new URL(served).origin
  )
    return;
  const failed = (error) =>
    console.error("[ayme] The Page Objects ayme mcp serves at " + served + " did not load.", error);
  Promise.all([
    import(served + ${JSON.stringify(RUNTIME_MODULE)}),
    import(served + ${JSON.stringify(ENTRY_MODULE)}),
  ]).then(([{ createAyme }, { default: pageObjects }]) => {
    const ayme = createAyme({
      agentConnection: true,
      inspector: { placement: "external" },
      pageObjects,
    });
    ayme.start();
    let registered = pageObjects;
    let loaded;
    new EventSource(${JSON.stringify(events)}).onmessage = ({ data }) => {
      const stamp = JSON.parse(data);
      if (loaded === undefined) return void (loaded = stamp);
      if (stamp.runtime !== loaded.runtime) return location.reload();
      if (stamp.entry === loaded.entry) return;
      loaded = stamp;
      import(served + ${JSON.stringify(ENTRY_MODULE)} + "?build=" + stamp.entry).then(
        ({ default: rebuilt }) => {
          for (const model of registered) ayme.pom.unregister(model);
          for (const model of rebuilt) ayme.pom.register(model);
          registered = rebuilt;
        },
        failed
      );
    };
  }, failed);
})();
`;
}

/**
 * The `.gitignore` of {@link AYME_FOLDER} with the init script ignored: the
 * user's text, if any, kept as it is, and the init script's line added
 * unless a line already ignores it.
 */
export function ignoringInitScript(gitignore: string | undefined): string {
  const lines = (gitignore ?? "").split(/\r?\n/).map((line) => line.trim());
  if (
    lines.includes(INIT_SCRIPT_FILE) ||
    lines.includes(`/${INIT_SCRIPT_FILE}`)
  )
    return gitignore!;
  if (gitignore === undefined || gitignore === "")
    return `# ayme mcp writes init-script.js, with its port, each time it starts.\n${INIT_SCRIPT_FILE}\n`;
  const separator = gitignore.endsWith("\n") ? "" : "\n";
  return `${gitignore}${separator}${INIT_SCRIPT_FILE}\n`;
}
