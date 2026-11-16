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
 * document, it follows the build stamps of the server on `port`, imports
 * the runtime and the entry of the first one, starts the runtime with the
 * Agent Connection on and registers the entry's classes, with the
 * Inspector in a window of its own, which the page serves only once
 * `ayme_inspect`'s URL is opened. After a rebuild of the entry it imports
 * the new entry and swaps its classes in for the old ones, keeping the old
 * ones if that fails; after a rebuild of the runtime, which it cannot swap,
 * it reloads the page. It loads one build at a time, the newest it was told
 * of, and a build that fails to load is loaded again on the next stamp. A
 * frame or a document such as `about:blank` loads nothing, so only the tab
 * pairs, and neither does a page of `ayme mcp`'s own, such as the
 * Inspector's window. It is a classic script, as an init script runs.
 *
 * It runs before the page's own scripts, so it waits for the document's
 * `load`, and then for the page to go idle, before it follows the stamps:
 * a page that ships Ayme has started its runtime by then, and gets none
 * from ayme mcp, so one runtime pairs. It knows that runtime by the
 * Inspector contract every started browser runtime publishes on the
 * document's global (ADR-0049). A page that starts Ayme only later still
 * gets both.
 */
export function initScript(port: number): string {
  const served = `http://127.0.0.1:${port}${SERVED_PATH}`;
  const events = `ws://127.0.0.1:${port}${EVENTS_PATH}`;
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
  const load = (name, stamp) => import(served + name + "?build=" + stamp);
  const same = (a, b) => a?.entry === b?.entry && a?.runtime === b?.runtime;
  let ayme, registered, loaded, wanted, loading = false;
  const swap = (rebuilt) => {
    for (const model of registered) ayme.pom.unregister(model);
    const added = [];
    try {
      for (const model of rebuilt) {
        ayme.pom.register(model);
        added.push(model);
      }
    } catch (error) {
      for (const model of added) ayme.pom.unregister(model);
      for (const model of registered) ayme.pom.register(model);
      throw error;
    }
    registered = rebuilt;
  };
  const loadWanted = async () => {
    if (loading) return;
    loading = true;
    try {
      while (!same(wanted, loaded)) {
        const stamp = wanted;
        if (loaded && stamp.runtime !== loaded.runtime) return location.reload();
        if (ayme === undefined) {
          const [{ createAyme }, { default: pageObjects }] = await Promise.all([
            load(${JSON.stringify(RUNTIME_MODULE)}, stamp.runtime),
            load(${JSON.stringify(ENTRY_MODULE)}, stamp.entry),
          ]);
          if (!same(stamp, wanted)) continue;
          ayme = createAyme({
            agentConnection: true,
            inspector: { placement: "external" },
            pageObjects,
          });
          ayme.start();
          registered = pageObjects;
        } else {
          const { default: rebuilt } = await load(${JSON.stringify(ENTRY_MODULE)}, stamp.entry);
          if (!same(stamp, wanted)) continue;
          swap(rebuilt);
        }
        loaded = stamp;
      }
    } catch (error) {
      failed(error);
    } finally {
      loading = false;
    }
  };
  // A WebSocket, which, unlike a stream over HTTP, holds none of the
  // browser's few connections to the server.
  let retry = 1000, followed = false;
  const follow = () => {
    const socket = new WebSocket(${JSON.stringify(events)});
    socket.onopen = () => {
      followed = true;
      retry = 1000;
    };
    socket.onerror = () => {
      if (!followed && retry === 1000) failed(new Error("No connection to " + socket.url));
    };
    socket.onmessage = ({ data }) => {
      wanted = JSON.parse(data);
      void loadWanted();
    };
    socket.onclose = () => {
      setTimeout(follow, retry);
      retry = Math.min(retry * 2, 30000);
    };
  };
  // A browser runtime publishes its Inspector contract here when it starts.
  const shipsAyme = () =>
    window[Symbol.for("ayme.inspectorContract")]?.contract !== undefined;
  const begin = () => {
    if (!shipsAyme()) follow();
  };
  const afterLoad = () =>
    window.requestIdleCallback
      ? window.requestIdleCallback(begin, { timeout: 1000 })
      : setTimeout(begin);
  if (window.document.readyState === "complete") afterLoad();
  else window.addEventListener("load", afterLoad, { once: true });
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
