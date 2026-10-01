import type { PointerEvent, Ref } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  GripVerticalIcon,
  MinusIcon,
  MonitorIcon,
  MoonIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PictureInPicture2Icon,
  SunIcon,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";

import { Badge } from "@ayme-dev/design-system/components/badge";
import { usePortalContainer } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

import { AymeMark } from "../AymeMark";
import type { Layout, ThemePreference } from "./preferences";

const iconButton =
  "inline-grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The panel's header: the ayme title, the page badge, the theme switch, the
 * layout menu and collapse. The panel drags by it.
 */
export function Header({
  pageName,
  layout,
  theme,
  onThemeChange,
  onLayoutChange,
  onCollapse,
  onPointerDown,
  collapseRef,
}: {
  /** The page's name, e.g. ListPage. */
  pageName?: string;
  layout: Layout;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onLayoutChange: (layout: Layout) => void;
  onCollapse: () => void;
  /** A press on the header outside its controls: the start of a drag. */
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  collapseRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <header
      className={cn(
        "relative z-10 flex h-[50px] flex-none touch-none items-center gap-1.5 border-b pr-2 pl-3.5 select-none",
        layout === "float"
          ? "cursor-grab active:cursor-grabbing"
          : "cursor-move"
      )}
      onPointerDown={(event) => {
        const target = event.target as Element;
        if (target.closest("button, input, select, textarea, label, a")) return;
        onPointerDown?.(event);
      }}
    >
      {layout === "float" && (
        <GripVerticalIcon
          className="-mr-0.5 -ml-1.5 size-3.5 text-muted-foreground"
          aria-hidden
        />
      )}
      <AymeMark className="h-[18px] w-[22px] flex-none" />
      <h2 className="text-sm font-semibold">ayme</h2>
      {pageName && (
        <Badge
          variant="secondary"
          className="bg-accent font-mono text-[11px] text-accent-foreground"
        >
          {pageName}
        </Badge>
      )}
      <span className="flex-1" />
      <ThemeSwitch theme={theme} onChange={onThemeChange} />
      <LayoutMenu layout={layout} onChange={onLayoutChange} />
      <button
        ref={collapseRef}
        type="button"
        aria-label="Collapse inspector"
        aria-expanded
        className={iconButton}
        onClick={onCollapse}
      >
        <MinusIcon className="size-4" />
      </button>
    </header>
  );
}

const themes: Record<
  ThemePreference,
  { label: string; next: ThemePreference; Icon: LucideIcon }
> = {
  system: { label: "System", next: "light", Icon: MonitorIcon },
  light: { label: "Light", next: "dark", Icon: SunIcon },
  dark: { label: "Dark", next: "system", Icon: MoonIcon },
};

/** The System / Light / Dark switch: each press moves to the next one. */
function ThemeSwitch({
  theme,
  onChange,
}: {
  theme: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  const { label, next, Icon } = themes[theme];
  const name = `Theme: ${label}. Switch to ${themes[next].label}.`;
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      className={iconButton}
      onClick={() => onChange(next)}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

export const layoutNames: Record<Layout, string> = {
  float: "Floating",
  left: "Dock left",
  right: "Dock right",
  bottom: "Dock to bottom",
};

const layoutIcons: Record<Layout, LucideIcon> = {
  float: PictureInPicture2Icon,
  left: PanelLeftIcon,
  right: PanelRightIcon,
  bottom: PanelBottomIcon,
};

const layouts = Object.keys(layoutNames) as Layout[];

/** The small layout menu: floating, or docked left, right or to the bottom. */
function LayoutMenu({
  layout,
  onChange,
}: {
  layout: Layout;
  onChange: (layout: Layout) => void;
}) {
  const container = usePortalContainer();
  const Icon = layoutIcons[layout];
  const name = `Layout: ${layoutNames[layout]}`;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={name}
        title={name}
        className={cn(
          iconButton,
          "flex w-auto gap-0.5 pr-1 pl-1.5 aria-expanded:bg-muted aria-expanded:text-foreground"
        )}
      >
        <Icon className="size-3.5" />
        <ChevronDownIcon className="size-3" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          aria-label="Layout"
          align="end"
          sideOffset={4}
          className="z-50 flex min-w-[190px] flex-col rounded-[10px] border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <DropdownMenu.RadioGroup
            value={layout}
            onValueChange={(value) => onChange(value as Layout)}
          >
            {layouts.map((option) => {
              const OptionIcon = layoutIcons[option];
              return (
                <DropdownMenu.RadioItem
                  key={option}
                  value={option}
                  className="flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2 text-[12.5px] outline-none data-highlighted:bg-muted"
                >
                  <OptionIcon className="size-3.5 text-muted-foreground in-data-[state=checked]:text-primary" />
                  <span className="flex-1">{layoutNames[option]}</span>
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon className="size-3.5" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
