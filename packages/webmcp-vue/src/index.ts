import {
  defineComponent,
  getCurrentInstance,
  getCurrentScope,
  inject,
  onScopeDispose,
  provide,
  readonly,
  shallowRef,
  watch,
  type InjectionKey,
  type PropType,
} from "vue";
import {
  createRuntimeSession,
  createServerPageObject,
  createPageRegistration,
  type AymePage,
  type RuntimeSession,
  type PageObjectConstructor,
} from "@ayme-dev/webmcp/internal";

export type { AymeWebMcpPublicationStatus } from "@ayme-dev/webmcp/internal";
export type UseAymeWebMcpOptions = {
  page?: AymePage;
  ignore?: (element: Element) => boolean;
};
const runtimeKey: InjectionKey<RuntimeSession> = Symbol("Ayme runtime");

function inheritedRuntime() {
  return getCurrentInstance() ? inject(runtimeKey, undefined) : undefined;
}

function ownRuntime(options: UseAymeWebMcpOptions = {}) {
  const runtime = createRuntimeSession(options.page, {
    ignore: options.ignore,
  });
  if (typeof window !== "undefined") {
    const stop = runtime.start();
    onScopeDispose(stop);
  }
  if (getCurrentInstance()) provide(runtimeKey, runtime);
  return runtime;
}

function consumeRuntime(runtime: RuntimeSession) {
  const publicationStatus = shallowRef(runtime.getSnapshot());
  const unsubscribe = runtime.subscribe(() => {
    publicationStatus.value = runtime.getSnapshot();
  });
  onScopeDispose(unsubscribe);
  return {
    publicationStatus: readonly(publicationStatus),
    retryPublication: runtime.retryPublication,
  };
}

export const AymeWebMcpProvider = defineComponent({
  name: "AymeWebMcpProvider",
  props: {
    page: { type: Object as PropType<AymePage>, required: false },
    ignore: {
      type: Function as PropType<(element: Element) => boolean>,
      required: false,
    },
  },
  setup(props, { slots }) {
    if (inheritedRuntime())
      throw new Error(
        "AymeWebMcpProvider cannot be nested beneath another Ayme runtime owner."
      );
    const page = props.page;
    const ignore = props.ignore;
    ownRuntime({ page, ignore });
    watch(
      () => [props.page, props.ignore] as const,
      ([nextPage, nextIgnore]) => {
        if (nextPage !== page || nextIgnore !== ignore)
          throw new Error(
            "The provider options must stay fixed while mounted. Remount the provider to change them."
          );
      },
      { flush: "sync" }
    );
    return () => slots.default?.();
  },
});

export function useAymeWebMcp(options: UseAymeWebMcpOptions = {}) {
  if (!getCurrentScope())
    throw new Error(
      "useAymeWebMcp must be called within an active Vue effect scope"
    );
  const inherited = inheritedRuntime();
  if (inherited && options.page !== undefined)
    throw new Error(
      "Configure page on the ancestor AymeWebMcpProvider or standalone useAymeWebMcp owner."
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
  // SSR renders event closures, but never constructs or registers a real POM.
  if (typeof window === "undefined") return createServerPageObject(model);
  const runtime = inheritedRuntime();
  if (runtime) {
    const instance = runtime.construct(model);
    onScopeDispose(runtime.register(model, instance));
    return instance;
  }
  // Preserve same-scope and effectScope usage of the standalone Vue owner.
  const registration = createPageRegistration(model);
  onScopeDispose(() => registration.dispose());
  return registration.instance;
}
