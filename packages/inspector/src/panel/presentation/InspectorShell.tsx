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
  resizeFloat,
  type Dock,
  type HostReservation,
  type Side,
} from "../domain/geometry";
import { Header, layoutNames } from "../view/Header";
import type { Layout, Preferences } from "../domain/preferences";
import { resizeGrip, usePointerDrag } from "../../shared";
import { currentViewport, useViewport } from "./useViewport";

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Handle = Side | Corner;

// Each handle straddles the panel's border and shows a resize grip: a pill
// centred on its edge, or an arc along its corner; a pressed pill stretches.
// Offsets count from the panel's padding edge and its 1px border lies just
// outside it, so an edge handle (8px) sits 4.5px out to centre on the border
// line. Grips are 3px thick, so they land on whole pixels either side of it,
// and are placed by offsets: a centring transform rounds them half a pixel off;
// a corner arc sits 2px out, with the border's radius plus its stroke's
// overhang.
// Stryker disable StringLiteral,ObjectLiteral: the grips' Tailwind classes are styling, which no test reads.
const edgeGrip = "after:rounded-full";
const cornerGrip =
  "z-30 size-5 after:size-4 after:border-0 after:bg-transparent active:after:bg-transparent";

const handleClass: Record<Handle, string> = {
  left: `${edgeGrip} inset-y-0 -left-[4.5px] w-2 cursor-ew-resize after:top-[calc(50%-20px)] after:left-[calc(50%-1.5px)] after:h-10 after:w-[3px] active:after:scale-y-125`,
  right: `${edgeGrip} inset-y-0 -right-[4.5px] w-2 cursor-ew-resize after:top-[calc(50%-20px)] after:left-[calc(50%-1.5px)] after:h-10 after:w-[3px] active:after:scale-y-125`,
  top: `${edgeGrip} inset-x-0 -top-[4.5px] h-2 cursor-ns-resize after:top-[calc(50%-1.5px)] after:left-[calc(50%-20px)] after:h-[3px] after:w-10 active:after:scale-x-125`,
  bottom: `${edgeGrip} inset-x-0 -bottom-[4.5px] h-2 cursor-ns-resize after:top-[calc(50%-1.5px)] after:left-[calc(50%-20px)] after:h-[3px] after:w-10 active:after:scale-x-125`,
  "top-left": `${cornerGrip} -top-2 -left-2 cursor-nwse-resize after:top-[6px] after:left-[6px] after:rounded-tl-[15px] after:border-t-3 after:border-l-3`,
  "top-right": `${cornerGrip} -top-2 -right-2 cursor-nesw-resize after:top-[6px] after:right-[6px] after:rounded-tr-[15px] after:border-t-3 after:border-r-3`,
  "bottom-left": `${cornerGrip} -bottom-2 -left-2 cursor-nesw-resize after:bottom-[6px] after:left-[6px] after:rounded-bl-[15px] after:border-b-3 after:border-l-3`,
  "bottom-right": `${cornerGrip} -right-2 -bottom-2 cursor-nwse-resize after:right-[6px] after:bottom-[6px] after:rounded-br-[15px] after:border-r-3 after:border-b-3`,
};

// Stryker restore StringLiteral,ObjectLiteral

/** The handles each layout resizes from: a floating panel from every side. */
const resizeHandles: Record<Layout, readonly Handle[]> = {
  float: [
    "left",
    "right",
    "top",
    "bottom",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
  ],
  left: ["right"],
  right: ["left"],
  bottom: ["top"],
};

function isCorner(handle: Handle): handle is Corner {
  return handle.includes("-");
}

/**
 * The panel's shell: it floats or docks, drags by its header, docks when
 * dropped on an edge, resizes, and collapses to the draggable logo. It shows
 * the preferences it's given and reports every change as a patch; its body
 * is the children. While docked, it asks the host page for room.
 */
export function InspectorShell({
  preferences,
  onPreferencesChange,
  reserveHost,
  children,
}: {
  preferences: Preferences;
  onPreferencesChange: (patch: Partial<Preferences>) => void;
  /** Makes room on the host page for the docked panel, or none. */
  reserveHost: (reservation: HostReservation | undefined) => void;
  children: ReactNode;
}) {
  const viewport = useViewport();
  const drag = usePointerDrag();
  const [snap, setSnap] = useState<Dock>();
  const { layout, collapsed } = preferences;
  const float = fitFloat(preferences.float ?? defaultFloat(viewport), viewport);
  const sideWidth = fitSideWidth(preferences.sideWidth, viewport);
  const bottomHeight = fitBottomHeight(preferences.bottomHeight, viewport);
  const docked = collapsed || layout === "float" ? undefined : layout;
  const dockedSize = layout === "bottom" ? bottomHeight : sideWidth;
  useEffect(
    () => reserveHost(docked && { dock: docked, size: dockedSize }),
    [reserveHost, docked, dockedSize]
  );
  // The room goes back when the shell unmounts.
  useEffect(() => () => reserveHost(undefined), [reserveHost]);

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

  const startResize = (event: PointerEvent, handle: Handle) => {
    // Without this, a press that lands on a text selection starts the
    // browser's own drag of it, which cancels the resize.
    event.preventDefault();
    drag(event, {
      onMove: (deltaX, deltaY) => {
        const viewportNow = currentViewport();
        if (layout === "float")
          onPreferencesChange({
            float: resizeFloat(
              float,
              handle.split("-") as Side[],
              { x: deltaX, y: deltaY },
              viewportNow
            ),
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
  };

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
          "@container pointer-events-auto absolute border bg-background",
          {
            float: "rounded-xl shadow-2xl",
            left: "border-y-0 border-l-0 shadow-lg",
            right: "border-y-0 border-r-0 shadow-lg",
            bottom: "border-x-0 border-b-0 shadow-lg",
          }[layout]
        )}
        style={placement[layout]}
      >
        {resizeHandles[layout].map((handle) => (
          <div
            key={handle}
            role="separator"
            aria-orientation={
              isCorner(handle)
                ? undefined
                : handle === "left" || handle === "right"
                  ? "vertical"
                  : "horizontal"
            }
            aria-label={`Resize from the ${handle} ${isCorner(handle) ? "corner" : "edge"}`}
            title="Drag to resize"
            className={cn(
              "absolute z-20 touch-none",
              resizeGrip,
              handleClass[handle]
            )}
            onPointerDown={(event) => startResize(event, handle)}
          />
        ))}
        {/* The panel's content clips to its rounded frame; the handles, outside
            this, straddle the border. */}
        <div className="flex size-full flex-col overflow-hidden rounded-[inherit]">
          <Header
            layout={layout}
            theme={preferences.theme}
            onThemeChange={(theme) => onPreferencesChange({ theme })}
            onLayoutChange={(next) => onPreferencesChange({ layout: next })}
            onCollapse={() => setCollapsed(true)}
            onPointerDown={startMove}
            collapseRef={collapseButton}
          />
          {children}
        </div>
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
      <span className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground">
        {layoutNames[dock]}
      </span>
    </div>
  );
}
