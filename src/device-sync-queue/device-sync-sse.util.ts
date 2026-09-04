import type { Response } from 'express';

export function writeSseHeaders(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

export function writeSseEvent(
  res: Response,
  data: Record<string, unknown>,
): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
