import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  createAyme,
  type Ayme,
  type AymeOptions,
  type AymeWebMcp,
} from "@ayme-dev/ayme";
import {
  sameRuntimeOptions,
  type PageObjectConstructor,
} from "@ayme-dev/ayme/internal";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";
/** The options of `createAyme`, passed to it unchanged. */
export type AymeProviderProps = AymeOptions & { children?: ReactNode };
const RuntimeContext = createContext<Ayme | undefined>(undefined);

export function AymeProvider({
  children,
  ...options
}: AymeProviderProps): ReactElement {
  const ancestor = useContext(RuntimeContext);
  const [setup] = useState(() => {
    const snapshot = {
      ...options,
      webMCP: options.webMCP && { ...options.webMCP },
    };
    return { options: snapshot, runtime: createAyme(snapshot) };
  });
  if (ancestor)
    throw new Error(
      "AymeProvider cannot be nested beneath another Ayme runtime owner."
    );
  if (!sameRuntimeOptions(options, setup.options))
    throw new Error(
      "The provider options must stay fixed while mounted. Remount the provider to change them."
    );
  useEffect(() => setup.runtime.start(), [setup]);
  return createElement(
    RuntimeContext.Provider,
    { value: setup.runtime },
    children
  );
}

function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Ayme hooks require an ancestor AymeProvider.");
  return runtime;
}

export type UseAymeResult = {
  /** The runtime session. */
  ayme: Ayme;
  /** The session's `webMCP` member, with its status as React state. */
  webMCP: Pick<AymeWebMcp, "publicationStatus" | "retryPublication">;
};

export function useAyme(): UseAymeResult {
  const runtime = useRuntime();
  const { webMCP } = runtime;
  const readStatus = () => webMCP.publicationStatus;
  const publicationStatus = useSyncExternalStore(
    webMCP.subscribe,
    readStatus,
    readStatus
  );
  return {
    ayme: runtime,
    webMCP: { publicationStatus, retryPublication: webMCP.retryPublication },
  };
}

export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  const runtime = useRuntime();
  const [retained] = useState(() => ({ model, runtime }));
  if (retained.model !== model || retained.runtime !== runtime)
    throw new Error(
      "The Page Object model and provider must stay fixed while mounted. Remount the component to change them."
    );
  useEffect(() => {
    runtime.pom.register(model);
    return () => runtime.pom.unregister(model);
  }, [runtime, model]);
  return runtime.pom.get(model);
}
