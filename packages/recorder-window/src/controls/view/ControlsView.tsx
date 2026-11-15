import type {
  RecorderCommand,
  RecorderState,
} from "@ayme-dev/recorder/contract";
import { Button } from "@ayme-dev/design-system/components/button";
import { Separator } from "@ayme-dev/design-system/components/separator";
import { Eye, ListX } from "lucide-react";

import { controlsOf, type Controls } from "../domain/controls";
import type { ThemePreference } from "../domain/theme";
import { PRIMARY_ICONS } from "./primaryIcon";
import { ThemeSwitch } from "./ThemeSwitch";

type OnCommand = (command: RecorderCommand) => void;

/**
 * The window's controls, in a compact bar. Which are shown and which can be
 * pressed now is read from the state (`controlsOf`): the view only lays
 * them out. A status shows only for what the controls do not show already:
 * the wrap-up, the save and the end.
 */
export function ControlsView({
  state,
  onCommand,
  theme,
}: {
  state: RecorderState | null;
  onCommand: OnCommand;
  theme: {
    preference: ThemePreference;
    onChange: (preference: ThemePreference) => void;
  };
}) {
  const controls = controlsOf(state);
  return (
    <header
      role="toolbar"
      aria-label="Recorder controls"
      className="sticky top-0 z-10 flex h-10 items-center gap-1 border-b bg-background px-2"
    >
      <PrimaryButton control={controls.primary} onCommand={onCommand} />
      <Separator
        orientation="vertical"
        className="mx-1 data-[orientation=vertical]:h-5"
      />
      <AssertButton control={controls.assert} onCommand={onCommand} />
      <p
        role="status"
        className="min-w-0 flex-1 truncate px-2 text-xs text-muted-foreground"
      >
        {controls.status}
      </p>
      <ClearButton control={controls.clear} onCommand={onCommand} />
      <ThemeSwitch {...theme} />
      <FinishButton control={controls.finish} onCommand={onCommand} />
    </header>
  );
}

function PrimaryButton({
  control,
  onCommand,
}: {
  control: Controls["primary"];
  onCommand: OnCommand;
}) {
  if (!control) return null;
  const Icon = PRIMARY_ICONS[control.command.type];
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={!control.enabled}
      onClick={() => onCommand(control.command)}
    >
      <Icon className="fill-current" />
      {control.label}
    </Button>
  );
}

function AssertButton({
  control,
  onCommand,
}: {
  control: Controls["assert"];
  onCommand: OnCommand;
}) {
  if (!control) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 aria-pressed:bg-secondary aria-pressed:text-foreground"
      aria-label={control.label}
      title={control.label}
      aria-pressed={control.pressed}
      disabled={!control.enabled}
      onClick={() => onCommand(control.command)}
    >
      <Eye />
    </Button>
  );
}

function ClearButton({
  control,
  onCommand,
}: {
  control: Controls["clear"];
  onCommand: OnCommand;
}) {
  if (!control) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={control.label}
      title={control.label}
      disabled={!control.enabled}
      onClick={() => onCommand(control.command)}
    >
      <ListX />
    </Button>
  );
}

function FinishButton({
  control,
  onCommand,
}: {
  control: Controls["finish"];
  onCommand: OnCommand;
}) {
  if (!control) return null;
  return (
    <Button
      size="sm"
      disabled={!control.enabled}
      onClick={() => onCommand(control.command)}
    >
      {control.label}
    </Button>
  );
}
