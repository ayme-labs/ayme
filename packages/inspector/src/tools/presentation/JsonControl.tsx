import { useState } from "react";

import type { JsonValue } from "@ayme-dev/ayme";

/** A value the form has no control for, typed as JSON. */
export function JsonControl({
  value,
  onChange,
  ...props
}: {
  id?: string;
  "aria-label": string;
  className: string;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
}) {
  const [draft, setDraft] = useState(() =>
    value === undefined ? "" : JSON.stringify(value)
  );
  const [error, setError] = useState<string>();
  return (
    <>
      <textarea
        {...props}
        rows={2}
        spellCheck={false}
        className={`${props.className} h-auto py-1.5 font-mono`}
        value={draft}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (text.trim() === "") {
            setError(undefined);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(text) as JsonValue);
            setError(undefined);
          } catch {
            // Sent as typed: the tool's own validation reports it.
            onChange(text);
            setError(`${props["aria-label"]}: invalid JSON.`);
          }
        }}
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}
