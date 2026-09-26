import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import { Fab } from "./Fab";
import {
  defaultFloat,
  defaultLogo,
  dockAt,
  fitBottomHeight,
  fitFloat,
  fitLogo,
  fitSideWidth,
  resizeFloatBottom,
  resizeFloatLeft,
  type Dock,
} from "./geometry";
import { Header, layoutNames } from "./Header";
import type { Layout, Preferences } from "./preferences";
import { usePointerDrag } from "./pointerDrag";
import { currentViewport, useViewport } from "./useViewport";

type Edge = "left" | "right" | "top" | "bottom";

const edgeClass: Record<Edge, string> = {
  left: "inset-y-0 left-0 w-[7px] cursor-col-resize after:inset-y-0 after:left-0 after:w-0.5",
  right:
    "inset-y-0 right-0 w-[7px] cursor-col-resize after:inset-y-0 after:right-0 after:w-0.5",
  top: "inset-x-0 top-0 h-[7px] cursor-row-resize after:inset-x-0 after:top-0 after:h-0.5",
  bottom:
    "inset-x-0 bottom-0 h-[7px] cursor-row-resize after:inset-x-0 after:bottom-0 after:h-0.5",
};

/** The edges each layout resizes from. */
const resizeEdges: Record<Layout, readonly Edge[]> = {
  float: ["left", "bottom"],
  left: ["right"],
  right: ["left"],
  bottom: ["top"],
};

/**
 * The panel's shell: it floats or docks, drags by its header, docks when
 * dropped on an edge, resizes, and collapses to the draggable logo. It shows
 * the preferences it's given and reports every change as a patch; its body
 * is the children.
 */
export function InspectorShell({
  preferences,
  onPreferencesChange,
  pageName,
  children,
}: {
  preferences: Preferences;
  onPreferencesChange: (patch: Partial<Preferences>) => void;
  pageName?: string;
  children: ReactNode;
}) {
  const viewport = useViewport();
  const drag = usePointerDrag();
  const [snap, setSnap] = useState<Dock>();
  const { layout, collapsed } = preferences;
  const float = fitFloat(preferences.float ?? defaultFloat(viewport), viewport);
  const sideWidth = fitSideWidth(preferences.sideWidth, viewport);
  const bottomHeight = fitBottomHeight(preferences.bottomHeight, viewport);

  // Collapsing moves focus to the logo and opening moves it back, but only
  // when the person did it, not when the panel starts collapsed.
  const logoButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (collapsed ? logoButton : collapseButton).current?.focus();
  }, [collapsed]);
  const setCollapsed = (next: boolean) => {
    moveFocus.current = true;
    onPreferencesChange({ collapsed: next });
  };

  if (collapsed)
    return (
      <Fab
        ref={logoButton}
        position={fitLogo(preferences.logo ?? defaultLogo(viewport), viewport)}
        viewport={viewport}
        onMove={(logo) => onPreferencesChange({ logo })}
        onOpen={() => setCollapsed(false)}
      />
    );

  // Dragging the header moves a floating panel and floats a docked one,
  // under the pointer; dropping it on an edge docks it there.
  const startMove = (event: PointerEvent) => {
    event.preventDefault();
    let origin: { x: number; y: number } | undefined;
    let dock: Dock | undefined;
    drag(event, {
      onMove: (deltaX, deltaY, pointer) => {
        origin ??=
          layout === "float"
            ? float
            : {
                x: pointer.x - deltaX - Math.min(200, float.width / 2),
                y: pointer.y - deltaY - 22,
              };
        const viewportNow = currentViewport();
        dock = dockAt(pointer, viewportNow);
        setSnap(dock);
        onPreferencesChange({
          layout: "float",
          float: fitFloat(
            { ...float, x: origin.x + deltaX, y: origin.y + deltaY },
            viewportNow
          ),
        });
      },
      onEnd: (moved) => {
        setSnap(undefined);
        if (moved && dock) onPreferencesChange({ layout: dock });
      },
    });
  };

  const startResize = (event: PointerEvent, edge: Edge) =>
    drag(event, {
      onMove: (deltaX, deltaY) => {
        const viewportNow = currentViewport();
        if (layout === "float")
          onPreferencesChange({
            float:
              edge === "left"
                ? resizeFloatLeft(float, deltaX)
                : resizeFloatBottom(float, deltaY, viewportNow),
          });
        else if (layout === "bottom")
          onPreferencesChange({
            bottomHeight: fitBottomHeight(bottomHeight - deltaY, viewportNow),
          });
        else
          onPreferencesChange({
            sideWidth: fitSideWidth(
              sideWidth + (layout === "left" ? deltaX : -deltaX),
              viewportNow
            ),
          });
      },
    });

  const placement: Record<Layout, CSSProperties> = {
    float: {
      left: float.x,
      top: float.y,
      width: float.width,
      height: float.height,
    },
    left: { left: 0, top: 0, bottom: 0, width: sideWidth },
    right: { right: 0, top: 0, bottom: 0, width: sideWidth },
    bottom: { left: 0, right: 0, bottom: 0, height: bottomHeight },
  };

  return (
    <>
      <aside
        aria-label="ayme"
        className={cn(
          "@container pointer-events-auto absolute flex flex-col overflow-hidden border bg-background",
          {
            float: "rounded-[14px] shadow-2xl",
            left: "border-y-0 border-l-0 shadow-lg",
            right: "border-y-0 border-r-0 shadow-lg",
            bottom: "border-x-0 border-b-0 shadow-lg",
          }[layout]
        )}
        style={placement[layout]}
      >
        {resizeEdges[layout].map((edge) => (
          <div
            key={edge}
            role="separator"
            aria-orientation={
              edge === "left" || edge === "right" ? "vertical" : "horizontal"
            }
            aria-label={`Resize from the ${edge} edge`}
            title="Drag to resize"
            className={cn(
              "absolute z-20 touch-none after:absolute after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-100",
              edgeClass[edge]
            )}
            onPointerDown={(event) => startResize(event, edge)}
          />
        ))}
        <Header
          pageName={pageName}
          layout={layout}
          theme={preferences.theme}
          onThemeChange={(theme) => onPreferencesChange({ theme })}
          onLayoutChange={(next) => onPreferencesChange({ layout: next })}
          onCollapse={() => setCollapsed(true)}
          onPointerDown={startMove}
          collapseRef={collapseButton}
        />
        {children}
      </aside>
      {snap && (
        <SnapPreview
          dock={snap}
          sideWidth={sideWidth}
          bottomHeight={bottomHeight}
        />
      )}
    </>
  );
}

/** Where the panel docks if it's dropped now. */
function SnapPreview({
  dock,
  sideWidth,
  bottomHeight,
}: {
  dock: Dock;
  sideWidth: number;
  bottomHeight: number;
}) {
  const inset = 8;
  const style: Record<Dock, CSSProperties> = {
    left: {
      left: inset,
      top: inset,
      bottom: inset,
      width: sideWidth - 2 * inset,
    },
    right: {
      right: inset,
      top: inset,
      bottom: inset,
      width: sideWidth - 2 * inset,
    },
    bottom: {
      left: inset,
      right: inset,
      bottom: inset,
      height: bottomHeight - 2 * inset,
    },
  };
  return (
    <div
      className="pointer-events-none absolute grid place-items-center rounded-xl border-2 border-dashed border-primary bg-accent/55"
      style={style[dock]}
    >
      <span className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground">
        {layoutNames[dock]}
      </span>
    </div>
  );
}
