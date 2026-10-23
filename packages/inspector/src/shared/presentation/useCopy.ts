import { useEffect, useRef, useState } from "react";

/** How long a Copy button says it copied. */
const COPIED_MS = 1200;

/**
 * Copying to the clipboard, and the text just copied, for a moment after,
 * so the Copy button that copied it can say so.
 */
export function useCopy() {
  const [copied, setCopied] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    copied,
    copy: (text: string) => {
      void navigator.clipboard?.writeText(text).then(
        () => {
          setCopied(text);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(undefined), COPIED_MS);
        },
        () => {
          // The page can deny the clipboard; the text can still be selected.
        }
      );
    },
  };
}
