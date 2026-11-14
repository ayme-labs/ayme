import type {
  RecorderCommand,
  RecorderState,
} from "@ayme-dev/recorder/contract";
import { Button } from "@ayme-dev/design-system/components/button";
import { Eye, ListX } from "lucide-react";

import { controlsOf, type Controls } from "../domain/controls";
import { PRIMARY_ICON_CLASSES, PRIMARY_ICONS } from "./primaryIcon";

type OnCommand = (command: RecorderCommand) => void;

/**
 * The window's controls. Which are shown and which can be pressed now is
 * read from the state (`controlsOf`): the view only lays them out. While the
 * recorder wraps up, nothing can be pressed.
 */
export function ControlsView({
  state,
  onCommand,
}: {
  state: RecorderState | null;
  onCommand: OnCommand;
}) {
  const controls = controlsOf(state);
  return (
    <header
      role="toolbar"
      aria-label="Recorder controls"
      className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur"
    >
      <PrimaryButton control={controls.primary} onCommand={onCommand} />
      <p
        role="status"
        className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
      >
        {controls.status}
      </p>
      <AssertButton control={controls.assert} onCommand={onCommand} />
      <ClearButton control={controls.clear} onCommand={onCommand} />
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
      disabled={!control.enabled}
      onClick={() => onCommand(control.command)}
    >
      <Icon className={PRIMARY_ICON_CLASSES[control.command.type]} />
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
      variant={
        control.pressed
          ? // Stryker disable next-line StringLiteral: the button's variants fall back to "default" for an empty name
            "default"
          : "outline"
      }
      aria-pressed={control.pressed}
      disabled={!control.enabled}
      onClick={() => onCommand(control.command)}
    >
      <Eye />
      {control.label}
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
      disabled={!control.enabled}
      onClick={() => onCommand(control.command)}
    >
      {control.label}
    </Button>
  );
}
