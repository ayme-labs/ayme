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
  createServerPageObject,
  type AymePage,
  type GoalLoopDecisionFunction,
  type PageObjectConstructor,
  type RefTool,
  type RuntimeSession,
} from "@ayme-dev/webmcp/internal";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/webmcp/internal";
export type AymeWebMcpProviderProps = {
  page?: AymePage;
  children?: ReactNode;
  ignore?: (element: Element) => boolean;
  refTools?: RefTool[];
  goalLoop?: GoalLoopDecisionFunction;
};
const RuntimeContext = createContext<RuntimeSession | undefined>(undefined);

export function AymeWebMcpProvider({
  page,
  ignore,
  refTools,
  goalLoop,
  children,
}: AymeWebMcpProviderProps): ReactElement {
  const ancestor = useContext(RuntimeContext);
  const [setup] = useState(() => ({
    page,
    ignore,
    refTools,
    goalLoop,
    runtime: createRuntimeSession(page, { ignore, refTools, goalLoop }),
  }));
  if (ancestor)
    throw new Error(
      "AymeWebMcpProvider cannot be nested beneath another Ayme runtime owner."
    );
  if (
    page !== setup.page ||
    ignore !== setup.ignore ||
    refTools !== setup.refTools ||
    goalLoop !== setup.goalLoop
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
  if (!runtime)
    throw new Error("Ayme hooks require an ancestor AymeWebMcpProvider.");
  return runtime;
}

export function useAymeWebMcp() {
  const runtime = useRuntime();
  const publicationStatus = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot
  );
  return { publicationStatus, retryPublication: runtime.retryPublication };
}

export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  const runtime = useRuntime();
  const [retained] = useState(() => ({
    model,
    runtime,
    instance:
      typeof window === "undefined"
        ? createServerPageObject(model)
        : runtime.construct(model),
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
