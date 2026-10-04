import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { SearchIcon } from "lucide-react";

import { cn } from "@ayme-dev/design-system/lib/utils";

import {
  checkKey,
  keyOfEvent,
  modifierOf,
  modifiersOnly,
  suggestKeys,
} from "../domain/keys";

type Mode = "record" | "search";

/**
 * The control of a key to press. Focusing it records the next key or combo
 * pressed; Esc switches it to a text box that searches key names. The icon
 * shows the mode and switches it.
 */
export function KeyField({
  id,
  "aria-label": label,
  className,
  value,
  onChange,
}: {
  id?: string;
  "aria-label": string;
  className?: string;
  value: string;
  onChange: (key: string | undefined) => void;
}) {
  const [mode, setMode] = useState<Mode>("record");
  const [focused, setFocused] = useState(false);
  // What's typed while searching: the value is what Playwright takes from it.
  const [draft, setDraft] = useState<string>();
  const [held, setHeld] = useState<readonly string[]>([]);
  const [active, setActive] = useState(0);
  const [listClosed, setListClosed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const listId = useId();

  const text = draft ?? value;
  const check = checkKey(text);
  const recording = mode === "record" && focused;
  const options =
    mode === "search" && focused && !listClosed ? suggestKeys(text) : [];
  const listOpen =
    options.length > 0 && !(options.length === 1 && options[0]!.label === text);

  useEffect(() => {
    if (mode === "search") input.current?.select();
  }, [mode]);

  const write = (next: string) => {
    setDraft(next);
    setActive(0);
    setListClosed(false);
    const checked = checkKey(next);
    // Sent as typed when it isn't a key: the tool's own error reports it.
    onChange(
      next.trim() === "" ? undefined : checked.ok ? checked.value : next
    );
  };
  const record = (key: string) => {
    setDraft(undefined);
    // Letting the modifiers go after a key records nothing more.
    setHeld([]);
    onChange(key);
  };
  const switchTo = (next: Mode) => {
    setMode(next);
    setHeld([]);
    setDraft(next === "search" ? value : undefined);
    setActive(0);
    setListClosed(false);
  };

  const onRecordKey = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const { key, ctrlKey, metaKey, altKey, shiftKey } = event;
    if (key === "Escape" && !(ctrlKey || metaKey || altKey || shiftKey))
      return switchTo("search");
    const modifier = modifierOf(key);
    if (!modifier) return record(keyOfEvent(event));
    if (event.repeat) return;
    setHeld((current) =>
      current.includes(modifier) ? current : [...current, modifier]
    );
  };
  const onRecordKeyUp = (event: KeyboardEvent) => {
    // Windows reports PrintScreen only as it's let go.
    if (event.key === "PrintScreen") return record(keyOfEvent(event));
    // A modifier pressed and let go on its own is the key, e.g. Shift.
    if (modifierOf(event.key) && held.length) record(modifiersOnly(held));
  };
  const onSearchKey = (event: KeyboardEvent) => {
    if (!listOpen) return;
    const move =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (move) {
      event.preventDefault();
      setActive((at) => (at + move + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const option = options[Math.min(active, options.length - 1)]!;
      // Tab leaves the field when picking would change nothing.
      if (event.key === "Tab" && option.label === text.trim()) return;
      event.preventDefault();
      write(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setListClosed(true);
    }
  };

  const fix = check.ok ? check.value !== text.trim() && check.value : check.fix;
  const fixButton = fix && (
    <button
      type="button"
      className="h-5 rounded-md border px-1.5 font-mono text-xs text-foreground hover:border-ring"
      // The field keeps focus, and searching, while the fix is taken.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => (focused ? write(fix) : onChange(fix))}
    >
      Use {fix}
    </button>
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            listOpen
              ? `${listId}-${Math.min(active, options.length - 1)}`
              : undefined
          }
          aria-describedby={helpId}
          aria-invalid={!check.ok}
          autoComplete="off"
          spellCheck={false}
          readOnly={mode === "record"}
          placeholder={
            mode === "record"
              ? "Press a key or combination"
              : "Search key names"
          }
          className={cn(
            className,
            "pr-8 font-mono aria-invalid:border-destructive",
            mode === "record" && "cursor-default caret-transparent"
          )}
          value={text}
          onChange={(event) => write(event.target.value)}
          onKeyDown={mode === "record" ? onRecordKey : onSearchKey}
          onKeyUp={mode === "record" ? onRecordKeyUp : undefined}
          onFocus={() => {
            setFocused(true);
            switchTo("record");
          }}
          onBlur={() => {
            setFocused(false);
            switchTo("record");
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={
            mode === "record"
              ? "Search key names instead"
              : "Record a key press instead"
          }
          title={
            mode === "record"
              ? "Search key names instead (Esc)"
              : "Record a key press instead"
          }
          className="absolute top-0.75 right-0.75 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            // Focusing starts recording; the switch after it wins.
            input.current?.focus();
            switchTo(mode === "record" ? "search" : "record");
          }}
        >
          {mode === "record" ? (
            <span
              className={cn(
                "size-2 rounded-full bg-destructive",
                recording && "motion-safe:animate-pulse"
              )}
              aria-hidden
            />
          ) : (
            <SearchIcon className="size-3.5" aria-hidden />
          )}
        </button>
        {listOpen && (
          <div
            id={listId}
            role="listbox"
            aria-label="Key names"
            className="absolute top-full right-0 left-0 z-20 mt-1 flex max-h-57.5 flex-col overflow-auto rounded-lg border bg-card p-1 shadow-lg"
          >
            {options.map((option, at) => (
              <div
                key={option.value}
                id={`${listId}-${at}`}
                role="option"
                aria-selected={at === active}
                className="cursor-pointer rounded px-2 py-1 font-mono text-xs hover:bg-muted aria-selected:bg-muted"
                onMouseDown={(event) => {
                  event.preventDefault();
                  write(option.value);
                }}
              >
                {option.label}
                {option.value.endsWith("+") && "+…"}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* One line high when empty, so Run doesn't move as focus leaves. */}
      <div className="flex min-h-[1lh] flex-wrap items-center gap-2 text-xs">
        <span
          id={helpId}
          role="status"
          aria-label={`${label} help`}
          className={recording ? "text-muted-foreground" : "text-destructive"}
        >
          {recording
            ? held.length
              ? `${held.map(modifierLabel).join(" + ")} + … then a key`
              : "Press a key or combo. Esc to search."
            : !check.ok && check.problem}
        </span>
        {!recording && fixButton}
      </div>
    </div>
  );
}

/** A held modifier as the keyboard shows it. */
function modifierLabel(modifier: string) {
  if (modifier !== "ControlOrMeta") return modifier;
  return /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";
}
