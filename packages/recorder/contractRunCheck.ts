import type { Reporter, TestModule } from "vitest/node";

// The contract suite runs in several projects, and a test may belong to only
// some of them: it is skipped in the others, as `it.runIf(attaching)` does.
// Vitest's own summary cannot tell such a declared skip from an accidental
// one, nor say that a whole project did not run. This reporter checks that
//
// - every test passed or was skipped,
// - every project named in the config passed at least one test, and
// - a test skipped in one project passed in another: a skip the suite
//   declares. A test skipped in every project, such as an `it.skip` left
//   behind or a condition that is never true, is not.
//
// A reporter cannot change Vitest's exit code, so it says what it found: it
// prints VERDICT only when both hold, and CI requires that line besides a
// passing run. A run where the check did not run at all prints none.

const VERDICT = "Contract run: every test ran and passed where it belongs";

export class ContractRunCheck implements Reporter {
  constructor(private readonly projects: readonly string[]) {}

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    /** Each test's state in each project it was collected in. */
    const states = new Map<string, Map<string, string>>();
    for (const module of testModules)
      for (const test of module.children.allTests()) {
        const name = `${module.moduleId} > ${test.fullName}`;
        const byProject = states.get(name) ?? new Map<string, string>();
        byProject.set(module.project.name, test.result().state);
        states.set(name, byProject);
      }

    const problems: string[] = [];
    for (const project of this.projects) {
      const passed = [...states.values()].some(
        (byProject) => byProject.get(project) === "passed"
      );
      if (!passed) problems.push(`The project "${project}" passed no test.`);
    }
    for (const [name, byProject] of states) {
      const results = [...byProject.values()];
      if (results.some((state) => state !== "passed" && state !== "skipped"))
        problems.push(`Did not pass: ${name}`);
      else if (results.includes("skipped") && !results.includes("passed"))
        problems.push(`Skipped in every project it ran in: ${name}`);
    }

    if (problems.length === 0) {
      console.log(`\n${VERDICT}\n`);
      return;
    }
    console.error(`\nContract run incomplete:\n- ${problems.join("\n- ")}\n`);
  }
}
