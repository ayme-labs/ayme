import { vi } from "vitest";

// Reachability geometry is covered in Chromium. Unit tests observe Page
// Object Roots for real on a layout that shows every root and lets every
// click reach it; a test measures another by overriding `measurePomRoot`.
vi.mock("./pomRootMeasurement", () => ({
  measurePomRoot: vi.fn(async () => ({ present: true, available: true })),
}));
