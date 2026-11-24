import type { EntryId } from "@ayme-dev/recorder/contract";

// Ids as tests write them by hand. Test-only: only tests import this folder
// (docs/testing.md#test-only-code).

export const entryId = (id: string) => id as EntryId;
