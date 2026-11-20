import type {
  RecorderCommand,
  RecorderState,
} from "@ayme-dev/recorder/contract";
import { Eye, LoaderCircle } from "lucide-react";

import { controlsOf, type Control, type Controls } from "../domain/controls";
import { PRIMARY_ICONS } from "./primaryIcon";

type OnCommand = (command: RecorderCommand) => void;

/** A round control of the pill: lit while what it stands for is on. Its
 * buttons take no focus: the page keeps its own. */
const round =
  "flex size-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 data-[on=true]:bg-blue-100 data-[on=true]:text-blue-600 dark:data-[on=true]:bg-blue-500/25 dark:data-[on=true]:text-blue-300 [&_svg]:size-3.5";

const props = (control: Control, onCommand: OnCommand) => ({
  type: "button" as const,
  "aria-label": control.label,
  title: control.label,
  tabIndex: -1,
  disabled: !control.enabled,
  onClick: () => onCommand(control.command),
});

/**
 * The toolbar in a recorded page: a small pill with the one control that
 * records, stops or continues, and Assert visibility. While the recorder
 * wraps up or saves, the first control says so and can not be pressed.
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
      className="pointer-events-auto flex items-center gap-1 rounded-full border bg-background/95 p-1 shadow-lg backdrop-blur"
    >
      <Busy controls={controls} />
      <PrimaryButton controls={controls} onCommand={onCommand} />
      <AssertButton control={controls.assert} onCommand={onCommand} />
    </div>
  );
}

/** What the recorder does while it wraps up or saves, in place of the
 * first control. */
function Busy({ controls }: { controls: Controls }) {
  if (!controls.busy) return null;
  return (
    <button
      type="button"
      data-busy
      className={round}
      aria-label={controls.status ?? undefined}
      title={controls.status ?? undefined}
      // Disabled, it takes no focus from the page.
      disabled
    >
      <LoaderCircle className="animate-spin" />
    </button>
  );
}

function PrimaryButton({
  controls,
  onCommand,
}: {
  controls: Controls;
  onCommand: OnCommand;
}) {
  const control = controls.primary;
  if (!control || controls.busy) return null;
  const Icon = PRIMARY_ICONS[control.command.type];
  return (
    <button
      className={round}
      data-on={control.command.type === "stop"}
      {...props(control, onCommand)}
    >
      <Icon className="fill-current" />
    </button>
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
    <button
      className={round}
      data-on={control.pressed}
      aria-pressed={control.pressed}
      {...props(control, onCommand)}
    >
      <Eye />
    </button>
  );
}
