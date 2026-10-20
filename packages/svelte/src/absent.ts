/**
 * What a build without Ayme resolves `@ayme-dev/svelte` to: the names of the
 * index with their types, over the runtime's absent entry, so a component
 * tree renders as with the real package. The owner's session is inert and
 * the consumers return its values; nothing here starts, stops or checks for
 * an owner, because there is nothing to own.
 */
import { getContext, setContext } from "svelte";
import { readable } from "svelte/store";
import { createAyme } from "@ayme-dev/ayme/absent";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";
import type { UseAymeOptions, UseAymeResult } from "./index";

export type {
  AymeWebMcpPublicationStatus,
  UseAymeOptions,
  UseAymeResult,
} from "./index";

const runtimeKey = Symbol("Ayme runtime");

/**
 * Call during component initialisation. Beneath an owner, returns the owner's
 * value; otherwise becomes the owner of an inert session.
 */
export function useAyme(options?: UseAymeOptions): UseAymeResult {
  const inherited = getContext<UseAymeResult | undefined>(runtimeKey);
  if (inherited) return inherited;
  // The absent runtime reads the options for the publication error only.
  const ayme = createAyme(options);
  const owned: UseAymeResult = {
    ayme,
    webMCP: {
      publicationStatus: readable(ayme.webMCP.publicationStatus),
      retryPublication: ayme.webMCP.retryPublication,
    },
  };
  setContext(runtimeKey, owned);
  return owned;
}

export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  return useAyme().ayme.pom.register(model);
}

export function peek(read: () => unknown, name: string, id?: string): void {
  void read;
  void name;
  void id;
}
