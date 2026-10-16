import { vi } from "vitest";

// Reachability geometry is covered in Chromium. Unit tests observe Page
// Object Roots and the elements Browser Tools address for real on a layout
// that shows every element and lets every click reach it; a test measures
// another by overriding `measurePomRoot` or `measureReach`.
vi.mock("./reachMeasurement", () => ({
  measurePomRoot: vi.fn(async () => ({ present: true, available: true })),
  measureReach: vi.fn(() => ({ present: true, available: true })),
}));
