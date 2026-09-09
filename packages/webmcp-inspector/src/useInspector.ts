import { onBeforeUnmount, onMounted, ref } from "vue";

import type { RegisteredPom } from "@ayme-dev/webmcp/internal";
import {
  capturePageState,
  getPageStateForElements,
  listRegisteredPomTargets,
  listRegisteredPoms,
  probeRegisteredPomMembers,
  subscribeToRegisteredPoms,
} from "@ayme-dev/webmcp/internal";

export function useInspector() {
  const registeredPoms = ref<RegisteredPom[]>([]);
  const pageState = ref<string>();
  const pageStateCapturedAt = ref<string>();
  const pageStateError = ref<string>();
  const pageStateLoading = ref(false);
  const applicationModelSelectionPath = ref<string>();

  const refreshPomMembers = () => probeRegisteredPomMembers();

  let pageStateRequestId = 0;
  let unsubscribeFromRegisteredPoms: (() => void) | undefined;
  let highlightObserver: MutationObserver | undefined;
  let highlightRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let highlightedElements: Element[] = [];
  let highlightRequestId = 0;
  let selectedApplicationModelPath: string | undefined;
  let hoveredApplicationModelPath: string | undefined;
  let unmounted = false;

  const clearHighlightedElements = () => {
    for (const element of highlightedElements)
      element.removeAttribute("data-ayme-highlight");
    highlightedElements = [];
  };

  const applyApplicationModelHighlight = async (path: string | undefined) => {
    const requestId = ++highlightRequestId;
    clearHighlightedElements();

    if (!path) return;

    try {
      const targets = (await listRegisteredPomTargets()).filter(
        (target) => target.path === path
      );
      const targetElements = uniqueElements(
        targets.map((target) => target.element)
      );
      const { state, refs: targetRefs } =
        await getPageStateForElements(targetElements);
      const refs = targetRefs.filter((ref): ref is string => ref !== undefined);
      const resolutions = await state.resolve(...refs);
      const elements = uniqueElements(
        resolutions.flatMap((resolution) =>
          resolution.status === "resolved" ? [resolution.node.element] : []
        )
      );
      if (unmounted || requestId !== highlightRequestId) return;

      for (const element of elements)
        element.setAttribute("data-ayme-highlight", "");
      highlightedElements = elements;
    } catch (error) {
      if (unmounted || requestId !== highlightRequestId) return;
      console.warn(`Could not highlight ${path}: ${errorMessage(error)}`);
    }
  };

  const previewApplicationModelTarget = (path: string) => {
    hoveredApplicationModelPath = path;
    void applyApplicationModelHighlight(
      hoveredApplicationModelPath ?? selectedApplicationModelPath
    );
  };

  const clearApplicationModelPreview = () => {
    hoveredApplicationModelPath = undefined;
    void applyApplicationModelHighlight(selectedApplicationModelPath);
  };

  const pinApplicationModelTarget = (path: string) => {
    selectedApplicationModelPath =
      selectedApplicationModelPath === path ? undefined : path;
    applicationModelSelectionPath.value = selectedApplicationModelPath;
    void applyApplicationModelHighlight(
      hoveredApplicationModelPath ?? selectedApplicationModelPath
    );
  };

  const schedulePinnedHighlightRefresh = (records?: MutationRecord[]) => {
    if (
      records?.length &&
      records.every(
        (record) =>
          record.type === "attributes" &&
          record.attributeName === "data-ayme-highlight"
      )
    )
      return;
    if (
      !selectedApplicationModelPath ||
      hoveredApplicationModelPath ||
      highlightRefreshTimer !== undefined
    )
      return;
    highlightRefreshTimer = setTimeout(() => {
      highlightRefreshTimer = undefined;
      if (selectedApplicationModelPath)
        void applyApplicationModelHighlight(selectedApplicationModelPath);
    }, 40);
  };

  const refreshPageState = async () => {
    const requestId = ++pageStateRequestId;
    pageStateLoading.value = true;
    pageStateError.value = undefined;

    try {
      const snapshot = await capturePageState(document.body);
      if (unmounted || requestId !== pageStateRequestId) return;
      pageState.value = snapshot;
      pageStateCapturedAt.value = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (error) {
      if (unmounted || requestId !== pageStateRequestId) return;
      pageStateError.value = errorMessage(error);
    } finally {
      if (!unmounted && requestId === pageStateRequestId)
        pageStateLoading.value = false;
    }
  };

  onMounted(() => {
    highlightObserver = new MutationObserver(schedulePinnedHighlightRefresh);
    highlightObserver.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    const updateRegisteredPoms = () => {
      registeredPoms.value = listRegisteredPoms();
      void refreshPageState();
    };
    updateRegisteredPoms();
    unsubscribeFromRegisteredPoms =
      subscribeToRegisteredPoms(updateRegisteredPoms);
  });

  onBeforeUnmount(() => {
    unmounted = true;
    highlightObserver?.disconnect();
    if (highlightRefreshTimer !== undefined)
      clearTimeout(highlightRefreshTimer);
    clearHighlightedElements();
    unsubscribeFromRegisteredPoms?.();
  });

  return {
    pageState,
    pageStateCapturedAt,
    pageStateError,
    pageStateLoading,
    applicationModelSelectionPath,
    refreshPageState,
    registeredPoms,
    refreshPomMembers,
    previewApplicationModelTarget,
    clearApplicationModelPreview,
    pinApplicationModelTarget,
  };
}

function uniqueElements(elements: readonly Element[]) {
  return [...new Set(elements)];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
