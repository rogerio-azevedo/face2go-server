import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import {
  type RecoveredJob,
  SUPERSEDED_JOB_ERROR,
} from '../database/queries/device-sync-jobs.queries';
import type { DeviceSyncJobRow } from '../database/schema/device-sync-jobs';
import {
  DeviceSyncJobHandlersService,
  JobCanceledError,
} from './device-sync-job-handlers.service';
import { DeviceSyncQueueService } from './device-sync-queue.service';
import { sleep } from './device-sync-sse.util';

const WORKER_CONCURRENCY = 2;
const POLL_IDLE_MS = 1500;
const HEARTBEAT_MS = 15_000;
/** Sem heartbeat por esse tempo, o job é considerado abandonado. */
const STALE_AFTER_SEC = 120;
const MAX_ATTEMPTS = 3;
const MAINTENANCE_MS = 30_000;
const PURGE_EVERY_MS = 10 * 60_000;
const RETENTION = { doneDays: 7, failedDays: 30, limit: 1000 };
/** Beanstalk dá ~30s entre SIGTERM e SIGKILL. */
const SHUTDOWN_GRACE_MS = 20_000;

@Injectable()
export class DeviceSyncWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeviceSyncWorkerService.name);
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private running = false;
  private loops: Promise<void>[] = [];
  private maintenanceTimer?: NodeJS.Timeout;
  private lastPurgeAt = 0;

  constructor(
    private readonly queue: DeviceSyncQueueService,
    private readonly handlers: DeviceSyncJobHandlersService,
  ) {}

  onModuleInit(): void {
    this.running = true;
    void this.maintain().finally(() => {
      if (!this.running) return;
      this.loops = Array.from({ length: WORKER_CONCURRENCY }, () =>
        this.loop(),
      );
      this.maintenanceTimer = setInterval(
        () => void this.maintain(),
        MAINTENANCE_MS,
      );
      this.maintenanceTimer.unref();
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    clearInterval(this.maintenanceTimer);
    let graceTimer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      Promise.all(this.loops).then(() => true),
      new Promise<boolean>((resolve) => {
        graceTimer = setTimeout(() => resolve(false), SHUTDOWN_GRACE_MS);
      }),
    ]);
    clearTimeout(graceTimer);
    if (drained) return;
    try {
      const released = await this.queue.recoverRunning(
        { lockedBy: this.workerId },
        MAX_ATTEMPTS,
      );
      if (released.length > 0) {
        this.log.warn(
          `shutdown: ${released.length} job(s) devolvido(s) para a fila`,
        );
      }
    } catch (err) {
      this.log.warn(`shutdown: ${errorMessage(err)}`);
    }
  }

  /** Reaper de jobs abandonados + retenção. Roda em todas as instâncias. */
  async maintain(): Promise<void> {
    try {
      const recovered = await this.queue.recoverRunning(
        { staleSeconds: STALE_AFTER_SEC },
        MAX_ATTEMPTS,
      );
      if (recovered.length > 0) {
        this.log.warn(
          `reaper: ${recovered.length} job(s) sem heartbeat (${summarize(recovered)})`,
        );
        await this.persistAbandoned(recovered);
      }
      if (Date.now() - this.lastPurgeAt >= PURGE_EVERY_MS) {
        this.lastPurgeAt = Date.now();
        const purged = await this.queue.purgeFinished(RETENTION);
        if (purged > 0) this.log.log(`retenção: ${purged} job(s) removido(s)`);
      }
    } catch (err) {
      this.log.warn(`manutenção: ${errorMessage(err)}`);
    }
  }

  private async persistAbandoned(recovered: RecoveredJob[]): Promise<void> {
    const ended = recovered.filter((r) => r.status !== 'queued');
    if (ended.length === 0) return;
    const rows = await this.queue.listByIds(ended.map((r) => r.id));
    for (const row of rows) {
      if (row.error === SUPERSEDED_JOB_ERROR) continue;
      await this.handlers.persistFailedFacePerson(
        row,
        row.status === 'canceled' ? 'Sync cancelado.' : (row.error ?? ''),
      );
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const job = await this.queue.claimNext(this.workerId);
        if (!job) {
          await sleep(POLL_IDLE_MS);
          continue;
        }
        await this.runJob(job);
      } catch (err) {
        this.log.warn(`worker: ${errorMessage(err)}`);
        await sleep(POLL_IDLE_MS);
      }
    }
  }

  async runJob(job: DeviceSyncJobRow): Promise<void> {
    const heartbeat = setInterval(() => {
      this.queue.heartbeat(job.id, this.workerId).catch((err: unknown) => {
        this.log.warn(`job=${job.id} heartbeat: ${errorMessage(err)}`);
      });
    }, HEARTBEAT_MS);
    heartbeat.unref();
    try {
      await this.handlers.run(job, {
        checkpoint: async () => {
          if (await this.queue.isCancelRequested(job.id)) {
            throw new JobCanceledError();
          }
        },
      });
      await this.queue.finish(job.id, this.workerId, { status: 'done' });
    } catch (err) {
      const canceled = err instanceof JobCanceledError;
      const message = errorMessage(err);
      if (!canceled) this.log.warn(`job=${job.id} falhou: ${message}`);
      const owned = await this.queue.finish(job.id, this.workerId, {
        status: canceled ? 'canceled' : 'failed',
        error: message,
      });
      if (owned) {
        await this.handlers.persistFailedFacePerson(
          job,
          canceled ? 'Sync cancelado.' : message,
        );
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarize(recovered: RecoveredJob[]): string {
  const counts = new Map<string, number>();
  for (const r of recovered)
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return [...counts].map(([status, n]) => `${status}=${n}`).join(' ');
}
