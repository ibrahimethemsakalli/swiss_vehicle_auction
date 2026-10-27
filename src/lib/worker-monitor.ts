import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type WorkerState = {
  name: string;
  intervalMs: number;
  maxRunMs: number;
  registeredAt: string;
  state: 'waiting' | 'running' | 'ok' | 'error' | 'disabled';
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSucceededAt: string | null;
  consecutiveFailures: number;
  totalFailures: number;
  lastErrorAt: string | null;
  lastErrorCode: 'WORKER_FAILED' | null;
  skippedOverlaps: number;
};
export type RuntimeState = {
  instanceId: string;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  stopping: boolean;
  workers: WorkerState[];
};
export function workerIsStale(worker: WorkerState, now = Date.now()) {
  if (worker.state === 'disabled') return false;
  if (worker.state === 'running') return now - Date.parse(worker.lastStartedAt!) > worker.maxRunMs;
  return (
    now - Date.parse(worker.lastFinishedAt ?? worker.registeredAt) >
    worker.intervalMs * 3 + worker.maxRunMs
  );
}
export function runtimeHealthy(state: RuntimeState, now = Date.now()) {
  return (
    !state.stopping &&
    now - Date.parse(state.heartbeatAt) < 20000 &&
    state.workers.length > 0 &&
    state.workers.every((w) => w.state !== 'error' && !workerIsStale(w, now))
  );
}
export function runtimePath(
  instanceId: string,
  root = process.env.OPERATIONS_DIR ?? join(process.cwd(), '.local', 'operations'),
) {
  if (!/^[a-f0-9-]{36}$/.test(instanceId)) throw new Error('INVALID_INSTANCE');
  return join(root, `${instanceId}.json`);
}
export async function readRuntime() {
  try {
    return JSON.parse(
      await readFile(runtimePath(process.env.OPS_INSTANCE_ID ?? ''), 'utf8'),
    ) as RuntimeState;
  } catch {
    return null;
  }
}
export class WorkerMonitor {
  readonly state: RuntimeState;
  private writing: Promise<void> = Promise.resolve();
  constructor(
    private root = process.env.OPERATIONS_DIR ?? join(process.cwd(), '.local', 'operations'),
    private clock = () => Date.now(),
  ) {
    const now = this.now();
    this.state = {
      instanceId: randomUUID(),
      pid: process.pid,
      startedAt: now,
      heartbeatAt: now,
      stopping: false,
      workers: [],
    };
  }
  private now() {
    return new Date(this.clock()).toISOString();
  }
  async persist() {
    this.state.heartbeatAt = this.now();
    const snapshot = JSON.stringify(this.state);
    const path = runtimePath(this.state.instanceId, this.root);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(this.root, { recursive: true });
        const tmp = `${path}.${randomUUID()}.tmp`;
        await writeFile(tmp, snapshot, { flag: 'wx', mode: 0o600 });
        await rename(tmp, path);
      });
    await this.writing;
  }
  register(name: string, intervalMs: number, maxRunMs: number, enabled = true) {
    if (this.state.workers.some((w) => w.name === name)) throw new Error('DUPLICATE_WORKER');
    const worker: WorkerState = {
      name,
      intervalMs,
      maxRunMs,
      registeredAt: this.now(),
      state: enabled ? 'waiting' : 'disabled',
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSucceededAt: null,
      consecutiveFailures: 0,
      totalFailures: 0,
      lastErrorAt: null,
      lastErrorCode: null,
      skippedOverlaps: 0,
    };
    this.state.workers.push(worker);
    return async (task: () => Promise<unknown>) => {
      if (worker.state === 'disabled' || this.state.stopping) return;
      if (worker.state === 'running') {
        worker.skippedOverlaps++;
        return;
      }
      worker.state = 'running';
      worker.lastStartedAt = this.now();
      try {
        await this.persist();
        await task();
        worker.state = 'ok';
        worker.lastSucceededAt = this.now();
        worker.consecutiveFailures = 0;
      } catch {
        worker.state = 'error';
        worker.consecutiveFailures++;
        worker.totalFailures++;
        worker.lastErrorAt = this.now();
        worker.lastErrorCode = 'WORKER_FAILED';
        // Never log exception text: provider errors may contain keys, PII or connection URLs.
        console.error(
          JSON.stringify({
            event: 'worker.failed',
            worker: name,
            at: worker.lastErrorAt,
            consecutiveFailures: worker.consecutiveFailures,
          }),
        );
      } finally {
        worker.lastFinishedAt = this.now();
        await this.persist().catch(() => console.error('Worker telemetry persistence failed'));
      }
    };
  }
}
