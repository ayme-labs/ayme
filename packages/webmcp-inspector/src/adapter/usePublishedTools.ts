import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { RegisteredPom } from "@ayme-dev/webmcp/internal";
import {
  getPageContextTool,
  getPublicationStatus,
  listPublishedTools,
  subscribeToPublishedTools,
  subscribeToRegisteredPoms,
} from "@ayme-dev/webmcp/internal";

import type { PomDefinitionText } from "../lenses/toolsLens";
import type { Publication, PublishedTool } from "../lenses/toolGroups";
import { errorMessage } from "./useInspector";

/**
 * The tools WebMCP publishes now and the publication status, as the runtime
 * reports them. A Page object tool carries the model whose action it is.
 */
export function usePublishedTools(registeredPoms: readonly RegisteredPom[]) {
  const published = useSyncExternalStore(
    subscribeToPublishedTools,
    listPublishedTools
  );
  const publication: Publication = useSyncExternalStore(
    subscribeToPublishedTools,
    getPublicationStatus
  );
  const tools = useMemo(() => {
    const modelByTool = new Map<string, string>();
    for (const { manifest, tools } of registeredPoms)
      for (const tool of tools)
        if (!modelByTool.has(tool.name))
          modelByTool.set(
            tool.name,
            tool.componentClassName ?? manifest.className
          );
    return published.map((tool): PublishedTool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      group: tool.group,
      ...(tool.group === "pageObject" && modelByTool.has(tool.name)
        ? { pomClassName: modelByTool.get(tool.name) }
        : {}),
    }));
  }, [published, registeredPoms]);
  return { tools, publication };
}

/**
 * A Page Object Model's definition exactly as an agent receives it: what
 * get_page_context returns for that model's name.
 */
export function usePomDefinition(className: string | undefined) {
  const [definition, setDefinition] = useState<PomDefinitionText>();
  // A registration can change the definition; read it again then.
  const [registrations, setRegistrations] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeToRegisteredPoms(() =>
      setRegistrations((count) => count + 1)
    );
    return () => void unsubscribe();
  }, []);
  useEffect(() => {
    if (!className) return;
    let current = true;
    getPageContextTool
      .execute({ names: [className] })
      .then((payload) => {
        const text = (payload as { pomDefinitions?: unknown }).pomDefinitions;
        if (current && typeof text === "string")
          setDefinition({ className, text });
      })
      .catch((error: unknown) => {
        console.warn(
          `Could not read the ${className} definition: ${errorMessage(error)}`
        );
      });
    return () => {
      current = false;
    };
  }, [className, registrations]);
  return definition;
}
