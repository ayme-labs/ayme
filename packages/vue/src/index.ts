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
} from "vue";
import {
  createAyme,
  type Ayme,
  type AymeOptions,
  type AymeWebMcp,
} from "@ayme-dev/ayme";
import {
  getStartedAyme,
  markRenderSession,
  sameRuntimeOptions,
  type PageObjectConstructor,
} from "@ayme-dev/ayme/internal";
import { providerProps } from "./providerProps";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/ayme";
/** The options of `createAyme`, passed to it unchanged. */
export type UseAymeOptions = AymeOptions;
const runtimeKey: InjectionKey<Ayme> = Symbol("Ayme runtime");

function inheritedRuntime() {
  return getCurrentInstance() ? inject(runtimeKey, undefined) : undefined;
}

function ownRuntime(options: UseAymeOptions = {}) {
  const runtime = renderable(createAyme(options));
  // A render session starts nothing.
  onScopeDispose(runtime.start());
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
  props: providerProps,
  setup(props, { slots }) {
    if (inheritedRuntime())
      throw new Error(
        "AymeProvider cannot be nested beneath another Ayme runtime owner."
      );
    const snapshotOptions = (): UseAymeOptions => ({
      ...props,
      // Copies, so a later change to the caller's list shows as a change.
      customTools: props.customTools && [...props.customTools],
      pageObjects: props.pageObjects && [...props.pageObjects],
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
            "The provider options changed while the provider was mounted."
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
      "useAyme(options) received options beneath an existing AymeProvider or useAyme owner."
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
  // session stands in. Nothing starts on the server, where a consumer without
  // an injected owner gets an inert Page Object from a shared inert session.
  const runtime =
    inheritedRuntime() ??
    getStartedAyme() ??
    (typeof window === "undefined"
      ? (inertSession ??= renderable(createAyme()))
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
 * @experimental
 */
export function usePeek(values: unknown, name: string, id?: string): void {
  const component = getCurrentInstance();
  if (!component)
    throw new Error("usePeek must be called in a component's setup");
  // The server never mounts, so it needs no session.
  const runtime = inheritedRuntime() ?? getStartedAyme();
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

let inertSession: Ayme | undefined;

// Without a window, Vue renders on the server, where a session must never
// claim the process.
function renderable(runtime: Ayme) {
  if (typeof window === "undefined") markRenderSession(runtime);
  return runtime;
}
