import {
  defineComponent,
  getCurrentInstance,
  getCurrentScope,
  inject,
  onScopeDispose,
  provide,
  shallowReactive,
  shallowReadonly,
  watch,
  type DefineComponent,
  type InjectionKey,
  type PropType,
} from "vue";
import {
  createAyme,
  type Ayme,
  type AymePage,
  type AymeWebMcp,
  type AymeWebMcpOptions,
  type CustomTool,
  type GoalLoopDecisionFunction,
} from "@ayme-dev/ayme";
import {
  getStartedAyme,
  type PageObjectConstructor,
} from "@ayme-dev/ayme/internal";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";
export type UseAymeOptions = {
  /** Builds the browser Page; called once, in the browser, on first use. */
  pageFactory?: () => AymePage;
  ignore?: (element: Element) => boolean;
  customTools?: CustomTool[];
  goalLoop?: GoalLoopDecisionFunction;
  webMCP?: AymeWebMcpOptions;
};
const runtimeKey: InjectionKey<Ayme> = Symbol("Ayme runtime");

function inheritedRuntime() {
  return getCurrentInstance() ? inject(runtimeKey, undefined) : undefined;
}

function ownRuntime(options: UseAymeOptions = {}) {
  const runtime = createAyme({
    pageFactory: options.pageFactory,
    ignore: options.ignore,
    customTools: options.customTools,
    goalLoop: options.goalLoop,
    webMCP: options.webMCP,
  });
  if (typeof window !== "undefined") {
    const stop = runtime.start();
    onScopeDispose(stop);
  }
  if (getCurrentInstance()) provide(runtimeKey, runtime);
  return runtime;
}

export type UseAymeResult = {
  /** The runtime session. */
  ayme: Ayme;
  /** The session's `webMCP` member, reactive and read-only. */
  webMCP: Readonly<Pick<AymeWebMcp, "publicationStatus" | "retryPublication">>;
};

function consumeRuntime(runtime: Ayme): UseAymeResult {
  const webMCP = shallowReactive({
    publicationStatus: runtime.webMCP.publicationStatus,
    retryPublication: runtime.webMCP.retryPublication,
  });
  const unsubscribe = runtime.webMCP.subscribe((status) => {
    webMCP.publicationStatus = status;
  });
  onScopeDispose(unsubscribe);
  return { ayme: runtime, webMCP: shallowReadonly(webMCP) };
}

// Annotated so the emitted declaration names only DefineComponent<Props>,
// which every Vue 3.2+ release accepts; the inferred type spells out the
// build-time Vue's full DefineComponent arity.
export const AymeProvider: DefineComponent<UseAymeOptions> = defineComponent({
  name: "AymeProvider",
  props: {
    pageFactory: {
      type: Function as PropType<() => AymePage>,
      required: false,
    },
    ignore: {
      type: Function as PropType<(element: Element) => boolean>,
      required: false,
    },
    customTools: { type: Array as PropType<CustomTool[]>, required: false },
    goalLoop: {
      type: Function as PropType<GoalLoopDecisionFunction>,
      required: false,
    },
    webMCP: {
      type: Object as PropType<AymeWebMcpOptions>,
      required: false,
    },
  },
  setup(props, { slots }) {
    if (inheritedRuntime())
      throw new Error(
        "AymeProvider cannot be nested beneath another Ayme runtime owner."
      );
    const pageFactory = props.pageFactory;
    const ignore = props.ignore;
    const customTools = props.customTools;
    const goalLoop = props.goalLoop;
    const webMCP = props.webMCP && { ...props.webMCP };
    ownRuntime({ pageFactory, ignore, customTools, goalLoop, webMCP });
    watch(
      () =>
        [
          props.pageFactory,
          props.ignore,
          props.customTools,
          props.goalLoop,
          props.webMCP?.enabled,
          props.webMCP?.toolNamePrefix,
        ] as const,
      ([
        nextPageFactory,
        nextIgnore,
        nextCustomTools,
        nextGoalLoop,
        nextEnabled,
        nextToolNamePrefix,
      ]) => {
        if (
          nextPageFactory !== pageFactory ||
          nextIgnore !== ignore ||
          nextCustomTools !== customTools ||
          nextGoalLoop !== goalLoop ||
          nextEnabled !== webMCP?.enabled ||
          nextToolNamePrefix !== webMCP?.toolNamePrefix
        )
          throw new Error(
            "The provider options must stay fixed while mounted. Remount the provider to change them."
          );
      },
      { flush: "sync" }
    );
    return () => slots.default?.();
  },
});

export function useAyme(options: UseAymeOptions = {}): UseAymeResult {
  if (!getCurrentScope())
    throw new Error("useAyme must be called within an active Vue effect scope");
  const inherited = inheritedRuntime();
  if (
    inherited &&
    (options.pageFactory !== undefined ||
      options.ignore !== undefined ||
      options.customTools !== undefined ||
      options.goalLoop !== undefined ||
      options.webMCP !== undefined)
  )
    throw new Error(
      "Configure pageFactory, ignore, customTools, goalLoop and webMCP on the ancestor AymeProvider or standalone useAyme owner."
    );
  return consumeRuntime(inherited ?? ownRuntime(options));
}

export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  if (!getCurrentScope())
    throw new Error(
      "usePageObject must be called within an active Vue effect scope"
    );
  // A standalone owner in this same scope is not inherited; in the browser it
  // is the started session.
  const runtime = inheritedRuntime() ?? getStartedAyme();
  if (runtime) {
    if (typeof window === "undefined") return runtime.pom.get(model);
    const instance = runtime.pom.register(model);
    onScopeDispose(() => runtime.pom.unregister(model));
    return instance;
  }
  // Server rendering has no started session; any session's Page Object is
  // inert there.
  if (typeof window === "undefined")
    return (inertSession ??= createAyme()).pom.get(model);
  throw new Error(
    "usePageObject requires useAyme() or an AymeProvider in this scope or an ancestor component."
  );
}

let inertSession: Ayme | undefined;
