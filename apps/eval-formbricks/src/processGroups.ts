/**
 * The process groups an agent's processes run in. The harness starts an
 * agent in a group of its own, but the agent may start an MCP server in
 * another, as Codex does, and that server its browser in a third; stopping
 * the agent's own group alone would leave those running.
 */
import { spawnSync } from "node:child_process";

/**
 * The groups of `pid` and of every process below it, from the lines of
 * `ps -axo pid=,ppid=,pgid=`.
 */
export function groupsBelow(pid: number, processTable: string): number[] {
  const children = new Map<number, { pid: number; group: number }[]>();
  let ownGroup = pid;
  for (const line of processTable.split("\n")) {
    const [id, parent, group] = line.trim().split(/\s+/).map(Number);
    if (id === undefined || parent === undefined || group === undefined)
      continue;
    if (id === pid) ownGroup = group;
    children.set(parent, [...(children.get(parent) ?? []), { pid: id, group }]);
  }
  const groups = new Set([ownGroup]);
  const queue = [pid];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const child of children.get(next) ?? []) {
      groups.add(child.group);
      queue.push(child.pid);
    }
  }
  return [...groups];
}

/** The groups of the running process `pid` and of every process below it. */
export function processGroups(pid: number): number[] {
  const table = spawnSync("ps", ["-axo", "pid=,ppid=,pgid="], {
    encoding: "utf8",
  });
  return groupsBelow(pid, table.status === 0 ? table.stdout : "");
}

/** Signals each group; one that is already gone, or that this process may not signal, is passed over. */
export function signalGroups(groups: Iterable<number>, signal: NodeJS.Signals) {
  for (const group of groups) {
    try {
      process.kill(-group, signal);
    } catch {
      // Gone already, or not this process's to signal.
    }
  }
}
