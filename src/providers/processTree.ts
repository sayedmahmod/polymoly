/** Stopping a child process together with everything it started (tool commands, MCP servers). */
import { ChildProcess, spawn } from 'node:child_process';

/** Spawn option that puts the child in its own process group, so `killTree` reaches its children. */
export const OWN_PROCESS_GROUP = process.platform !== 'win32';

/**
 * Sends SIGTERM to the child's process group, then SIGKILL after `graceMs` if the child is still
 * alive. The child must have been spawned with `detached: OWN_PROCESS_GROUP`.
 */
export function killTree(child: ChildProcess, graceMs = 2000): void {
  const alive = () => child.exitCode === null && child.signalCode === null;
  if (!alive() || !child.pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill());
    return;
  }
  const send = (signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, signal);
    } catch {
      child.kill(signal); // no group of its own, e.g. spawned without `detached`
    }
  };
  send('SIGTERM');
  setTimeout(() => {
    if (alive()) {
      send('SIGKILL');
    }
  }, graceMs).unref();
}
