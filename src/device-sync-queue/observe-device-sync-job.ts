import type { Response } from 'express';

import { DeviceSyncQueueService } from './device-sync-queue.service';
import { sleep, writeSseEvent } from './device-sync-sse.util';

const POLL_MS = 1000;

export async function observeDeviceSyncJob(
  queue: DeviceSyncQueueService,
  res: Response,
  jobId: string,
): Promise<void> {
  let lastProcessed = -1;
  let lastTotal = -1;
  for (;;) {
    const job = await queue.getById(jobId);
    if (!job) {
      writeSseEvent(res, { type: 'error', message: 'Job não encontrado.' });
      return;
    }
    if (lastTotal !== job.total) {
      writeSseEvent(res, { type: 'start', total: job.total });
      lastTotal = job.total;
    }
    if (job.processed !== lastProcessed) {
      writeSseEvent(res, {
        type: 'progress',
        processed: job.processed,
        total: job.total,
        jobId: job.id,
      });
      lastProcessed = job.processed;
    }
    if (job.status === 'done') {
      writeSseEvent(res, { type: 'done', processed: job.processed, total: job.total });
      return;
    }
    if (job.status === 'failed') {
      writeSseEvent(res, {
        type: 'error',
        message: job.error ?? 'Falha no sync.',
      });
      return;
    }
    writeSseEvent(res, { type: 'ping' });
    await sleep(POLL_MS);
  }
}

export async function observeDeviceSyncJobs(
  queue: DeviceSyncQueueService,
  res: Response,
  jobIds: string[],
): Promise<void> {
  writeSseEvent(res, { type: 'start', total: jobIds.length });
  if (jobIds.length === 0) {
    writeSseEvent(res, { type: 'done' });
    return;
  }
  let lastDone = -1;
  for (;;) {
    const rows = await queue.listByIds(jobIds);
    const done = rows.filter(
      (row) => row.status === 'done' || row.status === 'failed',
    ).length;
    if (done !== lastDone) {
      writeSseEvent(res, {
        type: 'progress',
        processed: done,
        total: jobIds.length,
      });
      lastDone = done;
    }
    if (done >= jobIds.length) {
      for (const row of rows) {
        writeSseEvent(res, {
          type: 'item',
          registrationId: row.targetId,
          ok: row.status === 'done',
          error: row.error ?? undefined,
        });
      }
      writeSseEvent(res, { type: 'done' });
      return;
    }
    writeSseEvent(res, { type: 'ping' });
    await sleep(POLL_MS);
  }
}
