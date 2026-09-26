/**
 * Highlighting on the page, by registry path. Hovering previews a highlight;
 * pinning keeps one until it is unpinned or another is pinned.
 */
export type HighlightControls = {
  pinnedPath: string | undefined;
  previewTarget: (path: string) => void;
  clearPreview: () => void;
  togglePinnedTarget: (path: string) => void;
};

/** What the Model lens's rows do with the highlight. */
export type Highlighting = {
  /** Handlers that preview a path's highlight while the row is hovered. */
  hover: (path: string | undefined) => {
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  };
  /** Pins a path's highlight, or unpins any when there is none. */
  pin: (path: string | undefined) => void;
  /** Pins a path's highlight, or unpins it when it is pinned. */
  togglePin: (path: string) => void;
  isPinned: (path: string | undefined) => boolean;
};

export function highlighting(controls: HighlightControls): Highlighting {
  return {
    hover: (path) =>
      path === undefined
        ? {}
        : {
            onMouseEnter: () => controls.previewTarget(path),
            onMouseLeave: controls.clearPreview,
          },
    pin: (path) => {
      if (path === controls.pinnedPath) return;
      const toggled = path ?? controls.pinnedPath;
      if (toggled !== undefined) controls.togglePinnedTarget(toggled);
    },
    togglePin: controls.togglePinnedTarget,
    isPinned: (path) => path !== undefined && path === controls.pinnedPath,
  };
}
