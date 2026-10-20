/**
 * What a build without Ayme resolves `@ayme-dev/react` to: the names of the
 * index with their types, over the runtime's absent entry, so a component
 * tree renders as with the real package. The provider renders its children
 * and the hooks return the inert session's values; nothing here owns a
 * session or checks who does, because there is nothing to start or stop.
 */
import {
  createContext,
  createElement,
  useContext,
  useState,
  type ReactElement,
} from "react";
import type { Ayme } from "@ayme-dev/ayme";
import { createAyme } from "@ayme-dev/ayme/absent";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";
import type { AymeProviderProps, UseAymeResult } from "./index";

export type {
  AymeProviderProps,
  AymeWebMcpPublicationStatus,
  UseAymeResult,
} from "./index";

const RuntimeContext = createContext<Ayme | undefined>(undefined);
let inert: Ayme | undefined;

export function AymeProvider({
  children,
  ...options
}: AymeProviderProps): ReactElement {
  // The absent runtime reads the options for the publication error only.
  const [runtime] = useState(() => createAyme(options));
  return createElement(RuntimeContext.Provider, { value: runtime }, children);
}

function useRuntime() {
  return useContext(RuntimeContext) ?? (inert ??= createAyme());
}

export function useAyme(): UseAymeResult {
  const ayme = useRuntime();
  return { ayme, webMCP: ayme.webMCP };
}

export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  return useRuntime().pom.register(model);
}

export function usePeek(values: unknown, name: string, id?: string): void {
  void values;
  void name;
  void id;
}
