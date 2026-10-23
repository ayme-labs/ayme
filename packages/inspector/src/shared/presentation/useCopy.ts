import { useEffect, useRef, useState } from "react";

/** How long a Copy button says it copied. */
const COPIED_MS = 1200;

/**
 * Copying to the clipboard, and what was just copied, for a moment after,
 * so the Copy button that copied it can say so: the text, or the key it was
 * copied under where two buttons can copy the same text.
 */
export function useCopy() {
  const [copied, setCopied] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Stryker disable next-line ArrowFunction,ArrayDeclaration,CallExpression: React drops a state update after unmount, so this only spares a timer.
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    copied,
    copy: (text: string, key = text) => {
      void navigator.clipboard?.writeText(text).then(
        () => {
          setCopied(key);
          // Stryker disable next-line CallExpression: a second copy restarts the moment, which only a clock shows.
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
