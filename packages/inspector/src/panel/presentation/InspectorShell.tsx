import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import { Fab } from "./Fab";
import {
  defaultLogo,
  dockAt,
  dockSize,
  dragFloat,
  fitLogo,
  fitSizes,
  growOrigin,
  inset,
  placement,
  resize,
  type Corner,
  type Dock,
  type Handle,
  type HostReservation,
  type Placement,
} from "../domain/geometry";
import { Header, layoutNames } from "../view/Header";
import { releaseVelocity, type Sample } from "../domain/motion";
import type { Layout, Preferences } from "../domain/preferences";
import { resizeGrip, usePointerDrag } from "../../shared";
import { useGlide } from "./useGlide";
import { usePointerClick } from "./usePointerClick";
import { usePresence } from "./usePresence";
import { currentViewport, useViewport } from "./useViewport";

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
  left: `${edgeGrip} inset-y-0 -left-[4.5px] w-2 cursor-ew-resize after:top-[calc(50%-20px)] after:left-[calc(50%-1.5px)] after:h-10 after:w-[3px] motion-safe:active:after:scale-y-125`,
  right: `${edgeGrip} inset-y-0 -right-[4.5px] w-2 cursor-ew-resize after:top-[calc(50%-20px)] after:left-[calc(50%-1.5px)] after:h-10 after:w-[3px] motion-safe:active:after:scale-y-125`,
  top: `${edgeGrip} inset-x-0 -top-[4.5px] h-2 cursor-ns-resize after:top-[calc(50%-1.5px)] after:left-[calc(50%-20px)] after:h-[3px] after:w-10 motion-safe:active:after:scale-x-125`,
  bottom: `${edgeGrip} inset-x-0 -bottom-[4.5px] h-2 cursor-ns-resize after:top-[calc(50%-1.5px)] after:left-[calc(50%-20px)] after:h-[3px] after:w-10 motion-safe:active:after:scale-x-125`,
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
 *
 * What the person does with a pointer moves it on a spring: it shrinks into
 * the logo and grows back out of it, glides to a dock picked from the layout
 * menu, and settles into the dock it's dropped on at the speed it was let
 * go. What a key or a screen reader does lands at once.
 */
export function InspectorShell({
  preferences,
  onPreferencesChange,
  reserveHost,
  status,
  children,
}: {
  preferences: Preferences;
  onPreferencesChange: (patch: Partial<Preferences>) => void;
  /** Makes room on the host page for the docked panel, or none. */
  reserveHost: (reservation: HostReservation | undefined) => void;
  /** What the header shows after its title. */
  status?: ReactNode;
  children: ReactNode;
}) {
  const viewport = useViewport();
  const drag = usePointerDrag();
  const [snap, setSnap] = useState<Dock>();
  const { layout, collapsed } = preferences;
  const sizes = fitSizes(preferences, viewport);
  const docked = collapsed || layout === "float" ? undefined : layout;
  const dockedSize = docked && dockSize(docked, sizes);
  useEffect(
    () => reserveHost(docked && { dock: docked, size: dockedSize! }),
    [reserveHost, docked, dockedSize]
  );
  // The room goes back when the shell unmounts.
  useEffect(() => () => reserveHost(undefined), [reserveHost]);

  // Collapsing moves focus to the logo and opening moves it back, but only
  // when the person did it, not when the panel starts collapsed. Only when
  // they did it with a pointer do the panel and the logo move.
  const pointerClick = usePointerClick();
  const logoButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (collapsed ? logoButton : collapseButton).current?.focus();
  }, [collapsed]);
  const setCollapsed = (next: boolean) => {
    moveFocus.current = true;
    setMoving(pointerClick.current);
    // A key or a screen reader lands a glide under way too.
    if (!pointerClick.current) glide.stop();
    onPreferencesChange({ collapsed: next });
  };
  // Collapsing, the panel shrinks toward the logo as the logo grows in;
  // opening is the same path back.
  const panel = usePresence<HTMLElement>(!collapsed, moving);
  const logo = usePresence<HTMLDivElement>(collapsed, moving);
  const glide = useGlide(panel.ref);
  const logoPosition = fitLogo(
    preferences.logo ?? defaultLogo(viewport),
    viewport
  );

  // Dragging the header moves a floating panel and floats a docked one,
  // under the pointer; dropping it on an edge docks it there. A docked panel
  // floats with the pointer as far along its header, and as far down, as
  // where it was taken hold of. The press takes hold of the panel where it
  // shows: grown all the way out of the logo, and held still mid-glide until
  // it moves, or goes on gliding once let go.
  const startMove = (event: PointerEvent) => {
    event.preventDefault();
    // Only the main button drags, and only on the header itself: React hands
    // the header presses in the layout menu too, through the menu's portal.
    const { currentTarget, target } = event;
    if (event.button !== 0 || !currentTarget.contains(target as Node)) return;
    panel.finish();
    const shown = panel.ref.current!.getBoundingClientRect();
    const press = { x: event.clientX, y: event.clientY };
    let dock: Dock | undefined;
    // Stryker disable next-line ArrayDeclaration: a sample without a time is never among the last 100ms, so the release speed leaves it out.
    const path: Sample[] = [];
    drag(event, {
      onMove: (deltaX, deltaY, pointer) => {
        // The first move stops the glide; the drag's path is empty until then.
        // Stryker disable next-line ConditionalExpression: stopping the glide on every move finds none left after the first.
        if (path.length === 0) glide.stop();
        const viewportNow = currentViewport();
        dock = dockAt(pointer, viewportNow);
        setSnap(dock);
        const moved = dragFloat(
          shown,
          press,
          { x: deltaX, y: deltaY },
          sizes.float,
          viewportNow
        );
        path.push({ x: moved.x, y: moved.y, time: performance.now() });
        onPreferencesChange({ layout: "float", float: moved });
      },
      onEnd: (moved) => {
        setSnap(undefined);
        glide.resume();
        if (!moved || !dock) return;
        // It settles into the dock carrying the speed it was let go at.
        glide.from(releaseVelocity(path, performance.now()));
        onPreferencesChange({ layout: dock });
      },
    });
    // Held once the drag has started: starting it lets go of any drag before,
    // which lets its glide go on.
    glide.hold();
  };

  const startResize = (event: PointerEvent, handle: Handle) => {
    // Without this, a press that lands on a text selection starts the
    // browser's own drag of it, which cancels the resize.
    event.preventDefault();
    drag(event, {
      onMove: (deltaX, deltaY) =>
        onPreferencesChange(
          resize(
            layout,
            handle,
            sizes,
            { x: deltaX, y: deltaY },
            currentViewport()
          )
        ),
    });
  };

  // The panel scales about the logo's centre, so it grows out of the logo
  // and shrinks back into it.
  const origin = growOrigin(layout, sizes, logoPosition, viewport);

  return (
    <>
      {logo.mounted && (
        <Fab
          ref={logoButton}
          presence={logo}
          position={logoPosition}
          viewport={viewport}
          onMove={(position) => onPreferencesChange({ logo: position })}
          onOpen={() => setCollapsed(false)}
        />
      )}
      {panel.mounted && (
        <aside
          ref={panel.ref}
          aria-label="ayme"
          data-presence
          data-state={panel.state}
          // Leaving, it's out of reach and out of the accessibility tree.
          inert={collapsed}
          aria-hidden={collapsed || undefined}
          className={cn(
            "@container pointer-events-auto absolute border bg-background",
            // Stryker disable StringLiteral,ObjectLiteral: Tailwind classes are styling, which no test reads.
            {
              float: "rounded-xl shadow-2xl",
              left: "border-y-0 border-l-0 shadow-lg",
              right: "border-y-0 border-r-0 shadow-lg",
              bottom: "border-x-0 border-b-0 shadow-lg",
            }[layout],
            // Stryker restore StringLiteral,ObjectLiteral
            panel.className
          )}
          style={{
            ...placement(layout, sizes),
            transformOrigin: `${origin.x}px ${origin.y}px`,
          }}
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
            this, straddle the border. It carries the panel's surface, which
            eases across a theme switch while the frame keeps its own
            transitions; the frame's own fill shows only past its rounded
            corners (inspector.css). */}
          <div className="flex size-full flex-col overflow-hidden rounded-[inherit] bg-background">
            <Header
              status={status}
              layout={layout}
              theme={preferences.theme}
              onThemeChange={(theme) => onPreferencesChange({ theme })}
              onLayoutChange={(next) => {
                // A layout chosen by a key or a screen reader lands at once,
                // the opening and any glide with it, though it's the same one.
                if (!pointerClick.current) {
                  glide.stop();
                  panel.finish();
                } else if (next !== layout) glide.from();
                onPreferencesChange({ layout: next });
              }}
              onCollapse={() => setCollapsed(true)}
              onPointerDown={startMove}
              collapseRef={collapseButton}
            />
            {children}
          </div>
        </aside>
      )}
      {snap && (
        <SnapPreview
          // A new edge's preview enters again.
          key={snap}
          dock={snap}
          placement={placement(snap, sizes)}
        />
      )}
    </>
  );
}

// Stryker disable StringLiteral,ObjectLiteral: Tailwind classes are styling, which no test reads.
const growsFrom: Record<Dock, string> = {
  left: "origin-left",
  right: "origin-right",
  bottom: "origin-bottom",
};
// Stryker restore StringLiteral,ObjectLiteral

/** Where the panel docks if it's dropped now. */
function SnapPreview({
  dock,
  placement,
}: {
  dock: Dock;
  /** Where the panel sits docked there. */
  placement: Placement;
}) {
  return (
    <div
      // It grows from the edge it docks to.
      className={cn(
        // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
        "pointer-events-none absolute grid place-items-center rounded-xl border-2 border-dashed border-primary bg-accent/55 transition-[opacity,scale] duration-(--duration-fast) ease-(--ease-out) starting:opacity-0 motion-safe:starting:scale-[0.97]",
        growsFrom[dock]
      )}
      // Drawn in from the dock, so the page shows around it.
      style={inset(placement, 8)}
    >
      <span className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground">
        {layoutNames[dock]}
      </span>
    </div>
  );
}
