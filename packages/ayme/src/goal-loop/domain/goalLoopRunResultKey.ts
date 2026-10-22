/**
 * The `globalThis` property that keeps the last Goal Loop run's result, so a
 * Playwright test can read it from the page. Its own module, with no imports,
 * so the testing entry loads in Node without the Goal Loop.
 */
export const goalLoopRunResultKey = "__aymeGoalLoopRunResultStore";
