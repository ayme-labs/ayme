import {
  defineComponent,
  getCurrentInstance,
  getCurrentScope,
  inject,
  onMounted,
  onScopeDispose,
  onUnmounted,
  provide,
  shallowReactive,
  shallowReadonly,
  unref,
  watch,
  type DefineComponent,
  type InjectionKey,
  type PropType,
} from "vue";
import {
  createAyme,
  type Ayme,
  type AymePage,
  type AymeOptions,
  type AymeWebMcp,
  type AymeWebMcpOptions,
  type CustomTool,
  type GoalLoopDecisionFunction,
} from "@ayme-dev/ayme";
import {
  sameRuntimeOptions,
  type PageObjectConstructor,
} from "@ayme-dev/ayme/internal";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";
/** The options of `createAyme`, passed to it unchanged. */
export type UseAymeOptions = AymeOptions;
const runtimeKey: InjectionKey<Ayme> = Symbol("Ayme runtime");

function inheritedRuntime() {
  return getCurrentInstance() ? inject(runtimeKey, undefined) : undefined;
}

function ownRuntime(options: UseAymeOptions = {}) {
  const runtime = createAyme(options);
  if (typeof window !== "undefined") {
    const stop = runtime.start();
    started = runtime;
    onScopeDispose(() => {
      stop();
      if (started === runtime) started = undefined;
    });
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

// Vue needs each prop declared; `satisfies` fails the build when a runtime
// option is missing here.
const providerProps = {
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
  // A default of undefined keeps an absent prop unset, not cast to false.
  inspector: {
    type: [Boolean, Object] as PropType<AymeOptions["inspector"]>,
    default: undefined,
  },
  agentConnection: { type: Boolean, default: undefined },
  navigate: {
    type: Function as PropType<NonNullable<UseAymeOptions["navigate"]>>,
    required: false,
  },
} satisfies Record<keyof UseAymeOptions, unknown>;

// Annotated so the emitted declaration names only DefineComponent<Props>,
// which every Vue 3.2+ release accepts; the inferred type spells out the
// build-time Vue's full DefineComponent arity.
export const AymeProvider: DefineComponent<UseAymeOptions> = defineComponent({
  name: "AymeProvider",
  props: providerProps,
  setup(props, { slots }) {
    if (inheritedRuntime())
      throw new Error(
        "AymeProvider cannot be nested beneath another Ayme runtime owner."
      );
    const snapshotOptions = (): UseAymeOptions => ({
      ...props,
      webMCP: props.webMCP && { ...props.webMCP },
      inspector:
        typeof props.inspector === "object"
          ? { ...props.inspector }
          : props.inspector,
    });
    const options = snapshotOptions();
    ownRuntime(options);
    watch(
      snapshotOptions,
      (next) => {
        if (!sameRuntimeOptions(next, options))
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
  if (inherited && Object.values(options).some((value) => value !== undefined))
    throw new Error(
      "Configure Ayme's options on the ancestor AymeProvider or standalone useAyme owner."
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
  // An owner's own scope does not inject what it provides, so the started
  // owner stands in. On the server any session's Page Object is inert.
  const runtime =
    inheritedRuntime() ??
    started ??
    (typeof window === "undefined"
      ? (inertSession ??= createAyme())
      : undefined);
  if (!runtime)
    throw new Error(
      "usePageObject requires useAyme() or an AymeProvider in this scope or an ancestor component."
    );
  const instance = runtime.pom.register(model);
  onScopeDispose(() => runtime.pom.unregister(model));
  return instance;
}

/**
 * Adds this component's instance of the Peek `name` while it is mounted,
 * through `ayme.peek`. `values` may be a ref, a reactive object or an object
 * of refs; the agent reads their current values. `id` defaults to one per
 * component instance.
 */
export function usePeek(values: unknown, name: string, id?: string): void {
  const component = getCurrentInstance();
  if (!component)
    throw new Error("usePeek must be called in a component's setup");
  // The server never mounts, so it needs no session.
  const runtime = inheritedRuntime() ?? started;
  if (!runtime && typeof window !== "undefined")
    throw new Error(
      "usePeek requires useAyme() or an AymeProvider in this component or an ancestor."
    );
  let remove: (() => void) | undefined;
  onMounted(() => {
    remove = runtime?.peek(
      () => read(values),
      name,
      id ?? String(component.uid)
    );
  });
  onUnmounted(() => remove?.());
}

function read(values: unknown) {
  const value = unref(values);
  if (value === null || typeof value !== "object") return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, unref(entry)])
  );
}

/** The started owner's session in the browser. */
let started: Ayme | undefined;
let inertSession: Ayme | undefined;
