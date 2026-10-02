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
  createRuntimeSession,
  type AymePage,
  type AymeWebMcp,
  type AymeWebMcpOptions,
  type CustomTool,
  type GoalLoopDecisionFunction,
  type RuntimeSession,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";
export type AymeProviderProps = {
  /** Builds the browser Page; called once, in the browser, on first use. */
  pageFactory?: () => AymePage;
  children?: ReactNode;
  ignore?: (element: Element) => boolean;
  customTools?: CustomTool[];
  goalLoop?: GoalLoopDecisionFunction;
  webMCP?: AymeWebMcpOptions;
};
const RuntimeContext = createContext<RuntimeSession | undefined>(undefined);

export function AymeProvider({
  pageFactory,
  ignore,
  customTools,
  goalLoop,
  webMCP,
  children,
}: AymeProviderProps): ReactElement {
  const ancestor = useContext(RuntimeContext);
  const [setup] = useState(() => {
    const fixedWebMCP = webMCP && { ...webMCP };
    return {
      pageFactory,
      ignore,
      customTools,
      goalLoop,
      webMCP: fixedWebMCP,
      runtime: createRuntimeSession({
        pageFactory,
        ignore,
        customTools,
        goalLoop,
        webMCP: fixedWebMCP,
      }),
    };
  });
  if (ancestor)
    throw new Error(
      "AymeProvider cannot be nested beneath another Ayme runtime owner."
    );
  if (
    pageFactory !== setup.pageFactory ||
    ignore !== setup.ignore ||
    customTools !== setup.customTools ||
    goalLoop !== setup.goalLoop ||
    webMCP?.enabled !== setup.webMCP?.enabled ||
    webMCP?.toolNamePrefix !== setup.webMCP?.toolNamePrefix
  )
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
  ayme: RuntimeSession;
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
  const [retained] = useState(() => ({
    model,
    runtime,
    instance: runtime.construct(model),
  }));
  if (retained.model !== model || retained.runtime !== runtime)
    throw new Error(
      "The Page Object model and provider must stay fixed while mounted. Remount the component to change them."
    );
  useEffect(
    () => runtime.register(model, retained.instance),
    [runtime, model, retained]
  );
  return retained.instance;
}
