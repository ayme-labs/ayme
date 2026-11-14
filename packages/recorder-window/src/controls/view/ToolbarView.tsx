import type {
  RecorderCommand,
  RecorderState,
} from "@ayme-dev/recorder/contract";
import { Button } from "@ayme-dev/design-system/components/button";
import { Eye, ListX } from "lucide-react";

import { controlsOf, type Control, type Controls } from "../domain/controls";
import { PRIMARY_ICON_CLASSES, PRIMARY_ICONS } from "./primaryIcon";

type OnCommand = (command: RecorderCommand) => void;

/** A toolbar button's name, state and press. Its buttons take no focus:
 * the page keeps its own. */
const props = (control: Control, onCommand: OnCommand) => ({
  "aria-label": control.label,
  title: control.label,
  tabIndex: -1,
  disabled: !control.enabled,
  onClick: () => onCommand(control.command),
});

/**
 * The toolbar in a recorded page: the window's controls, small. Which are
 * shown and which can be pressed now is read from the state, as in the
 * window.
 */
export function ToolbarView({
  state,
  onCommand,
}: {
  state: RecorderState | null;
  onCommand: OnCommand;
}) {
  const controls = controlsOf(state);
  return (
    <div
      role="toolbar"
      aria-label="Recorder toolbar"
      className="pointer-events-auto flex items-center gap-1 rounded-lg border bg-background/95 p-1 text-foreground shadow-lg backdrop-blur"
    >
      <PrimaryButton control={controls.primary} onCommand={onCommand} />
      <p
        role="status"
        className="max-w-56 truncate px-2 text-xs text-muted-foreground"
      >
        {controls.status}
      </p>
      <AssertButton control={controls.assert} onCommand={onCommand} />
      <ClearButton control={controls.clear} onCommand={onCommand} />
      <FinishButton control={controls.finish} onCommand={onCommand} />
    </div>
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
    <Button variant="ghost" size="sm" {...props(control, onCommand)}>
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
      variant={control.pressed ? "default" : "ghost"}
      size="icon"
      aria-pressed={control.pressed}
      {...props(control, onCommand)}
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
    <Button variant="ghost" size="icon" {...props(control, onCommand)}>
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
    <Button size="sm" {...props(control, onCommand)}>
      {control.label}
    </Button>
  );
}
