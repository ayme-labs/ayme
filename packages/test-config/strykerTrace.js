// DIAGNOSTIC, temporary: logs each tested mutant so a CI job killed mid-run
// shows how far it got. Remove before merging.
class TraceReporter {
  static inject = [];
  count = 0;
  onMutantTested(result) {
    this.count += 1;
    const { line, column } = result.location.start;
    console.log(
      `[trace ${new Date().toISOString().slice(11, 19)}] #${this.count} ${result.status} ${result.fileName}:${line + 1}:${column + 1} ${result.mutatorName} id=${result.id}`
    );
  }
}

export const strykerPlugins = [
  { kind: "Reporter", name: "trace", injectableClass: TraceReporter },
];
