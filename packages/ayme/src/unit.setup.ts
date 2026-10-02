import { vi } from "vitest";

// Reachability policy is covered in Chromium. Registry unit tests exercise the
// observation lifecycle without depending on layout geometry in jsdom.
vi.mock("./pomReachability", () => ({
  probePomRootState: async () => ({ present: true, available: true }),
}));
