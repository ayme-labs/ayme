/**
 * What a build without Ayme resolves `@ayme-dev/vue` to: the names of the
 * index with their types, over the runtime's absent entry, so a component
 * tree renders as with the real package. The provider renders its children
 * and the hooks return the inert session's values; nothing here owns a
 * session or checks who does, because there is nothing to start or stop.
 */
import {
  defineComponent,
  getCurrentInstance,
  inject,
  provide,
  type DefineComponent,
  type InjectionKey,
} from "vue";
import type { Ayme } from "@ayme-dev/ayme";
import { createAyme } from "@ayme-dev/ayme/absent";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";
import type { UseAymeOptions, UseAymeResult } from "./index";

export type {
  AymeWebMcpPublicationStatus,
  UseAymeOptions,
  UseAymeResult,
} from "./index";

const runtimeKey: InjectionKey<Ayme> = Symbol("Ayme runtime");
let inert: Ayme | undefined;

function inherited() {
  return getCurrentInstance() ? inject(runtimeKey, undefined) : undefined;
}

// The absent runtime reads the options for the publication error only.
function own(options?: UseAymeOptions) {
  const runtime = createAyme(options);
  if (getCurrentInstance()) provide(runtimeKey, runtime);
  return runtime;
}

export const AymeProvider: DefineComponent<UseAymeOptions> = defineComponent({
  name: "AymeProvider",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    own(attrs as UseAymeOptions);
    return () => slots.default?.();
  },
});

export function useAyme(options?: UseAymeOptions): UseAymeResult {
  const ayme = inherited() ?? own(options);
  return { ayme, webMCP: ayme.webMCP };
}

export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  return (inherited() ?? (inert ??= createAyme())).pom.register(model);
}

export function usePeek(values: unknown, name: string, id?: string): void {
  void values;
  void name;
  void id;
}
