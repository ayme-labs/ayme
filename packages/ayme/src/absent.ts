/**
 * What a Build without Ayme resolves `@ayme-dev/ayme` and
 * `@ayme-dev/ayme/internal` to: unless the build plugin's configuration
 * includes Ayme, its adapters resolve both entries here, so the runtime, the
 * Inspector, WebMCP and the Agent Connection stay out of the output. Setup
 * calls create an inert session, and each Page Object Model the plugin
 * compiles becomes a stand-in from `absentPageObject`. The exports mirror
 * the two entries' values the framework packages and the plugin's generated
 * code use; a missing one fails the build, naming it.
 */
import type { PageObjectConstructor } from "./page-objects";
import type { Run } from "./runs";
import type {
  Ayme,
  AymeOptions,
  AymeWebMcpPublicationStatus,
  ToolInfo,
} from "./runtime";
import { RuntimeStateError } from "./shared";

export {
  AymeError,
  callers,
  isJsonPrimitive,
  isJsonValue,
  RefResolutionError,
  RuntimeStateError,
  ToolInputError,
} from "./shared";
export { ayme } from "./page-objects";
export { DecisionEndpointError } from "./goal-loop";
export { sameRuntimeOptions, snapshotRuntimeOptions } from "./runtime";

const REMOVED = "Ayme was removed from this build.";

const removed = (what: string) =>
  new RuntimeStateError(`${REMOVED} ${what} is not in it.`);

const NO_TOOLS: readonly ToolInfo[] = Object.freeze([]);
const NO_RUNS: readonly Run[] = Object.freeze([]);
const PUBLICATION_STATUS: AymeWebMcpPublicationStatus = Object.freeze({
  state: "disabled",
  message: `WebMCP publication is disabled. ${REMOVED}`,
});
const noop = () => {};
const unsubscribed = () => noop;

/** Throws: a build without Ayme drives no page. */
export function createPage(): never {
  throw removed("The browser page");
}

/** A decision function that rejects: a build without Ayme runs no Goal Loop. */
export function decisionEndpoint(): () => Promise<never> {
  return () => Promise.reject(removed("The Decision Endpoint"));
}

const PUBLICATION_ENABLED =
  "Ayme was removed from this build, but setup enables WebMCP publication.";

/**
 * An inert session: it starts nothing, lists no tools and runs none, and its
 * Page Objects are the stand-ins the build compiled, one instance per class.
 * Setup that enables WebMCP publication logs an error, once, and goes on: a
 * build option the app forgot must not take the page down for its users.
 */
export function createAyme(options: AymeOptions = {}): Ayme {
  if (options.webMCP?.enabled === true) console.error(PUBLICATION_ENABLED);
  const instances = new Map<PageObjectConstructor, object>();
  const session: Ayme = {
    webMCP: {
      publicationStatus: PUBLICATION_STATUS,
      subscribe: unsubscribed,
      retryPublication: () => Promise.resolve(),
    },
    tools: {
      list: () => NO_TOOLS,
      subscribe: unsubscribed,
      run: (name) => Promise.reject(removed(`The tool "${name}"`)),
    },
    runs: { list: () => NO_RUNS, subscribe: unsubscribed },
    pom: {
      get<T extends object>(model: PageObjectConstructor<T>): T {
        let instance = instances.get(model) as T | undefined;
        if (!instance) {
          // As on the server: the class's prototype, no constructor run, so
          // a Page Object the build did not compile needs no page either.
          instance = Object.create(model.prototype as object) as T;
          instances.set(model, instance);
        }
        return instance;
      },
      register: (model) => session.pom.get(model),
      unregister: noop,
    },
    peek: unsubscribed,
    start: unsubscribed,
  };
  return session;
}

/** No session ever starts in a build without Ayme. */
export function getStartedAyme(): Ayme | undefined {
  return undefined;
}

export function markRenderSession(ayme: Ayme): void {
  void ayme;
}

/**
 * The base of the stand-in the build plugin compiles a Page Object Model to
 * in a build without Ayme: a class of the same name, whose actions reject
 * and whose other properties and methods, Page Object Children included,
 * throw, each naming what is missing. The class has no other member.
 */
export function absentPageObject(
  className: string,
  shape: {
    actions: readonly string[];
    properties: readonly string[];
    methods: readonly string[];
  }
): new () => object {
  const StandIn = class {};
  const missing = (member: string) => removed(`${className}.${member}`);
  const define = (name: string, descriptor: PropertyDescriptor) =>
    Object.defineProperty(StandIn.prototype, name, {
      ...descriptor,
      configurable: true,
    });
  for (const action of shape.actions)
    define(action, {
      value: () => Promise.reject(missing(action)),
      writable: true,
    });
  for (const method of shape.methods)
    define(method, {
      value: () => {
        throw missing(method);
      },
      writable: true,
    });
  for (const property of shape.properties)
    define(property, {
      get: () => {
        throw missing(property);
      },
    });
  return StandIn;
}
