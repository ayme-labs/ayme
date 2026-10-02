import { getContext, onDestroy, setContext } from "svelte";
import { readable, type Readable } from "svelte/store";
import {
  createRuntimeSession,
  RuntimeStateError,
  type AymeRuntimeOptions,
  type AymeWebMcp,
  type AymeWebMcpPublicationStatus,
  type RuntimeSession,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";
/** The options of `createRuntimeSession`, passed to it unchanged. */
export type UseAymeOptions = AymeRuntimeOptions;

export type UseAymeResult = {
  /** The runtime session. */
  ayme: RuntimeSession;
  /** The session's `webMCP` member, with the status as a readable store. */
  webMCP: Readonly<{
    publicationStatus: Readable<AymeWebMcpPublicationStatus>;
    retryPublication: AymeWebMcp["retryPublication"];
  }>;
};

const runtimeKey = Symbol("Ayme runtime");

function ownRuntime(options: UseAymeOptions | undefined): UseAymeResult {
  const ayme = createRuntimeSession(options);
  // Start during initialisation, not in onMount: a descendant's onMount runs
  // before the owner's and must already see a started runtime.
  if (typeof window !== "undefined") {
    try {
      onDestroy(ayme.start());
    } catch (error) {
      if (
        error instanceof RuntimeStateError &&
        error.message === "The Ayme runtime already has an active owner."
      )
        throw new RuntimeStateError(
          "useAyme(options) already has an active owner. Call it once, in the root +layout.svelte or App.svelte.",
          { cause: error }
        );
      throw error;
    }
  }
  const { webMCP } = ayme;
  return {
    ayme,
    webMCP: Object.freeze({
      // `subscribe` does not call its listener immediately, so each start
      // reads the current status before listening.
      publicationStatus: readable(webMCP.publicationStatus, (set) => {
        set(webMCP.publicationStatus);
        return webMCP.subscribe(() => set(webMCP.publicationStatus));
      }),
      retryPublication: webMCP.retryPublication,
    }),
  };
}

/**
 * Call during component initialisation. Without an ancestor owner, creates
 * the runtime session and, in the browser, starts it until the component is
 * destroyed. Beneath an owner, returns the owner's value.
 */
export function useAyme(options?: UseAymeOptions): UseAymeResult {
  const inherited = getContext<UseAymeResult | undefined>(runtimeKey);
  if (inherited && options !== undefined)
    throw new Error(
      "Configure Ayme on the ancestor useAyme(options) owner, not beneath it."
    );
  if (inherited) return inherited;
  const owned = ownRuntime(options);
  setContext(runtimeKey, owned);
  return owned;
}

/**
 * Call during component initialisation, beneath a `useAyme` owner. In the
 * browser, returns the concrete Page Object and keeps it registered until the
 * component is destroyed. On the server, returns an inert object with the
 * model's prototype and registers nothing.
 */
export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  const runtime = getContext<UseAymeResult | undefined>(runtimeKey);
  if (!runtime)
    throw new Error(
      "usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte."
    );
  const instance = runtime.ayme.construct(model);
  if (typeof window !== "undefined")
    onDestroy(runtime.ayme.register(model, instance));
  return instance;
}
