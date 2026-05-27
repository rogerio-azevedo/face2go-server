import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import AxiosDigestAuth from '@mhoc/axios-digest-auth';
import { Readable } from 'node:stream';

import {
  createReaderCredentialsCipher,
  type ReaderCredentialsCipher,
} from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as camerasQueries from '../database/queries/cameras.queries';
import type { CameraEventStreamRow } from '../database/queries/cameras.queries';
import {
  createSnapMultipartState,
  type SnapMultipartAccumState,
} from '../face-listener/snap-buffer-state.type';
import type { SnapImageSliceMeta } from '../face-listener/snap-stream.parser';
import {
  collectImageSlices,
  feedSnapMultipart,
  parseSnapManagerTextPart,
  sliceSnapJpeg,
} from '../face-listener/snap-stream.parser';
import { LprAccessesService } from '../lpr-accesses/lpr-accesses.service';
import type {
  CameraListenerStatus,
  CameraMonitorDeviceRow,
  CameraMonitorStatusReport,
  CameraStreamContext,
} from './lpr-listener.types';
import {
  type LprStreamReadingPayload,
  snapFlatMapToLprReading,
} from './lpr-stream.parser';

function hostFromIpPort(ip: string, port: number): string {
  return `${ip.trim()}:${port}`;
}

function toStreamContext(
  row: CameraEventStreamRow,
  cipher: ReaderCredentialsCipher,
): CameraStreamContext | undefined {
  try {
    const passwordPlain = cipher.decrypt(row.passwordEncrypted);
    return {
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      clientName: row.clientName,
      companyId: row.companyId,
      brand: row.brand,
      host: hostFromIpPort(row.ip, row.port),
      username: row.username.trim(),
      passwordPlain,
    };
  } catch {
    Logger.warn(
      `[LprListener] Senha inválida ou não descriptografável — câmera "${row.name}" (${row.id}) ignorada`,
    );
    return undefined;
  }
}

type SnapPending = {
  reading: LprStreamReadingPayload | null;
  images: Buffer[];
  slices: SnapImageSliceMeta[];
};

@Injectable()
export class LprListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LprListenerService.name);
  private readonly cipher: ReaderCredentialsCipher;

  /** Contexto atual da conexão (para persistência Snap multipart). */
  private streamCtxByCamera = new Map<string, CameraStreamContext>();

  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;

  private streamAbortByCamera = new Map<string, AbortController>();
  private connectGeneration = new Map<string, number>();

  private snapMultipartByCamera = new Map<string, SnapMultipartAccumState>();
  private snapPendingByCamera = new Map<string, SnapPending>();

  private static readonly REFRESH_INTERVAL_MS = 60_000;
  private static readonly LAST_SEEN_DEBOUNCE_MS = 30_000;

  private statuses = new Map<string, CameraListenerStatus>();
  private lastSeenDebounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly lprAccesses: LprAccessesService,
  ) {
    this.cipher = createReaderCredentialsCipher(
      this.configService.get('READER_ENCRYPTION_KEY', {
        infer: true,
      }),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connectAllLprCameras();
    } catch (err: unknown) {
      this.logger.error(
        `[LprListener] Init falhou: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }

    this.refreshIntervalId = setInterval(() => {
      void this.refreshConnections().catch((e: unknown) =>
        this.logger.warn(
          `[LprListener] Refresh falhou: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }, LprListenerService.REFRESH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
    for (const id of [...this.snapPendingByCamera.keys()]) {
      this.finalizeSnapPending(id);
    }

    for (const t of this.reconnectTimers.values()) clearTimeout(t);
    this.reconnectTimers.clear();
    for (const t of this.lastSeenDebounceTimers.values()) clearTimeout(t);
    this.lastSeenDebounceTimers.clear();

    for (const ac of this.streamAbortByCamera.values()) ac.abort();
    this.streamAbortByCamera.clear();
    this.streamCtxByCamera.clear();
  }

  async getMonitorReportForCompany(
    companyId: string,
    filterClientId?: string,
  ): Promise<CameraMonitorStatusReport> {
    const fromDb = await camerasQueries.listCamerasForMonitorReport(
      this.database.db,
      companyId,
      filterClientId,
    );

    const devices: CameraMonitorDeviceRow[] = fromDb.map((d) => {
      const host = hostFromIpPort(d.ip, d.port);
      const existing = this.statuses.get(d.id);
      const streamSupported =
        d.type === 'lpr' &&
        d.brand.toLowerCase().trim() === 'intelbras' &&
        d.hasCredentials &&
        d.isActive;

      const base: CameraMonitorDeviceRow = {
        cameraId: d.id,
        cameraName: d.name,
        clientName: d.clientName,
        type: d.type,
        brand: d.brand,
        host,
        isActive: d.isActive,
        hasCredentials: d.hasCredentials,
        streamSupported,
        connected: false,
        eventsReceived: 0,
        lastEventAt: null,
        connectedSince: null,
        lastConnectionError: null,
        lastSeenAt: d.lastSeenAt,
      };

      if (!streamSupported) {
        const err = !d.isActive
          ? 'Câmera inativa'
          : d.type !== 'lpr'
            ? 'Tipo diferente de lpr não entra no stream LPR'
            : d.brand.toLowerCase().trim() !== 'intelbras'
              ? 'Stream CGI suportado apenas para Intelbras'
              : !d.hasCredentials
                ? 'Credenciais não configuradas'
                : null;
        return { ...base, lastConnectionError: err };
      }

      if (existing) {
        return {
          ...base,
          connected: existing.connected,
          eventsReceived: existing.eventsReceived,
          lastEventAt: existing.lastEventAt ?? null,
          connectedSince: existing.connectedSince ?? null,
          lastConnectionError: existing.lastConnectionError ?? null,
        };
      }
      return base;
    });

    const connected = devices.filter((x) => x.connected).length;
    return {
      devices,
      summary: {
        total: devices.length,
        connected,
        disconnected: devices.length - connected,
      },
    };
  }

  private bumpConnectGeneration(cameraId: string): number {
    const n = (this.connectGeneration.get(cameraId) ?? 0) + 1;
    this.connectGeneration.set(cameraId, n);
    return n;
  }

  private clearReconnectTimer(id: string): void {
    const t = this.reconnectTimers.get(id);
    if (t) clearTimeout(t);
    this.reconnectTimers.delete(id);
  }

  private scheduleReconnect(cameraId: string, delayMs: number): void {
    this.clearReconnectTimer(cameraId);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(cameraId);
      void this.subscribeFromDb(cameraId);
    }, delayMs);
    this.reconnectTimers.set(cameraId, timer);
  }

  private abortStream(cameraId: string): void {
    const ac = this.streamAbortByCamera.get(cameraId);
    if (ac) {
      ac.abort();
      this.streamAbortByCamera.delete(cameraId);
    }
  }

  private teardownCamera(cameraId: string, reason: string): void {
    this.logger.log(`[LprListener] Encerrando câmera ${cameraId}: ${reason}`);
    this.clearReconnectTimer(cameraId);
    this.finalizeSnapPending(cameraId);

    this.bumpConnectGeneration(cameraId);
    this.abortStream(cameraId);

    this.snapMultipartByCamera.delete(cameraId);
    const t = this.lastSeenDebounceTimers.get(cameraId);
    if (t) clearTimeout(t);
    this.lastSeenDebounceTimers.delete(cameraId);
    this.streamCtxByCamera.delete(cameraId);
    this.statuses.delete(cameraId);
  }

  private updateStatus(
    cameraId: string,
    patch: Partial<CameraListenerStatus>,
  ): void {
    const cur = this.statuses.get(cameraId);
    if (cur) {
      this.statuses.set(cameraId, { ...cur, ...patch });
    }
  }

  private finalizeSnapPending(cameraId: string): void {
    this.tryFlushSnapPending(cameraId);
  }

  private getOrCreateSnapPending(cameraId: string): SnapPending {
    let pending = this.snapPendingByCamera.get(cameraId);
    if (!pending) {
      pending = { reading: null, images: [], slices: [] };
      this.snapPendingByCamera.set(cameraId, pending);
    }
    return pending;
  }

  /** Persiste quando texto ANPR e ao menos uma imagem estão prontos. */
  private isPersistableSnap(
    map: Map<string, string>,
    reading: LprStreamReadingPayload,
  ): boolean {
    const eventId = reading.correlationEventId?.trim() ?? '';
    return (
      this.isFlushableReading(reading) &&
      /^\d+$/.test(eventId) &&
      (reading.isAllowed != null || !!reading.vehicleType?.trim()) &&
      !!map.get('Events[0].TrafficCar.PlateNumber')?.trim()
    );
  }

  private isFlushableReading(reading: LprStreamReadingPayload): boolean {
    return (
      reading.eventCode === 'TrafficJunction' &&
      !!reading.correlationEventId?.trim() &&
      !!reading.direction?.trim()
    );
  }

  private discardIncompletePending(cameraId: string): void {
    const pend = this.snapPendingByCamera.get(cameraId);
    if (!pend) return;
    if (pend.reading && this.isFlushableReading(pend.reading)) return;
    this.snapPendingByCamera.delete(cameraId);
  }

  private tryFlushSnapPending(cameraId: string): void {
    const pend = this.snapPendingByCamera.get(cameraId);
    const ctx = this.streamCtxByCamera.get(cameraId);

    if (!pend?.reading || pend.images.length === 0 || !ctx) {
      return;
    }

    const reading = pend.reading;
    if (!this.isFlushableReading(reading)) {
      this.snapPendingByCamera.delete(cameraId);
      return;
    }

    const slices = pend.slices;
    const images = pend.images;
    this.snapPendingByCamera.delete(cameraId);

    const orderedJpegs = images.map((raw, idx) =>
      idx === 0 ? sliceSnapJpeg(raw, slices) : raw,
    );

    void this.lprAccesses
      .recordLprReading(reading, ctx, orderedJpegs)
      .catch((e: unknown) =>
        this.logger.warn(
          `[LprListener] Snap LPR persist falhou: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }

  private async connectAllLprCameras(): Promise<void> {
    const rows = await camerasQueries.listCamerasForEventStream(
      this.database.db,
    );
    const valid: CameraStreamContext[] = [];

    for (const row of rows) {
      const ctx = toStreamContext(row, this.cipher);
      if (ctx) valid.push(ctx);
    }

    if (valid.length === 0) {
      this.logger.warn(
        '[LprListener] Nenhuma câmera LPR Intelbras com credenciais — streams não iniciados',
      );
      return;
    }

    this.logger.log(
      `[LprListener] Iniciando snapManager em ${valid.length} câmera(s) LPR.`,
    );

    for (const ctx of valid) {
      this.ensureStatusRow(ctx);
      this.subscribe(ctx);
    }
  }

  private ensureStatusRow(ctx: CameraStreamContext): void {
    this.streamCtxByCamera.set(ctx.id, ctx);
    this.statuses.set(ctx.id, {
      cameraId: ctx.id,
      cameraName: ctx.name,
      clientName: ctx.clientName,
      brand: ctx.brand,
      host: ctx.host,
      connected: false,
      eventsReceived: 0,
    });
  }

  async refreshConnections(): Promise<void> {
    const rows = await camerasQueries.listCamerasForEventStream(
      this.database.db,
    );
    const validCtx: CameraStreamContext[] = [];

    for (const row of rows) {
      const ctx = toStreamContext(row, this.cipher);
      if (ctx) validCtx.push(ctx);
    }

    const validIds = new Set(validCtx.map((c) => c.id));

    for (const id of [...this.statuses.keys()]) {
      if (!validIds.has(id)) {
        this.teardownCamera(id, 'removida/inativa/sem credenciais');
      }
    }

    for (const ctx of validCtx) {
      const existing = this.statuses.get(ctx.id);
      this.streamCtxByCamera.set(ctx.id, ctx);

      if (!existing) {
        this.ensureStatusRow(ctx);
        this.subscribe(ctx);
        continue;
      }

      if ((existing.host ?? '') !== ctx.host) {
        this.abortStream(ctx.id);
        void this.finalizeSnapPending(ctx.id);
        this.snapMultipartByCamera.set(ctx.id, createSnapMultipartState());
        this.subscribe(ctx);
      }
      this.updateStatus(ctx.id, {
        cameraName: ctx.name,
        clientName: ctx.clientName,
        host: ctx.host,
        brand: ctx.brand,
      });
    }
  }

  private async subscribeFromDb(cameraId: string): Promise<void> {
    const row = await camerasQueries.getCameraForEventStreamById(
      this.database.db,
      cameraId,
    );
    if (!row) {
      this.teardownCamera(cameraId, 'sem dados elegíveis');
      return;
    }
    const ctx = toStreamContext(row, this.cipher);
    if (!ctx) return;

    if (!this.statuses.has(cameraId)) {
      this.ensureStatusRow(ctx);
    } else {
      this.updateStatus(cameraId, {
        cameraName: ctx.name,
        host: ctx.host,
        clientName: ctx.clientName,
      });
    }
    this.clearReconnectTimer(cameraId);
    this.streamCtxByCamera.set(ctx.id, ctx);
    this.subscribe(ctx);
  }

  private buildSnapUrl(host: string): string {
    return (
      `http://${host}/cgi-bin/snapManager.cgi` +
      `?action=attachFileProc&Flags[0]=Event&Events=[TrafficJunction]&heartbeat=5`
    );
  }

  private subscribe(ctx: CameraStreamContext): void {
    const gen = this.bumpConnectGeneration(ctx.id);
    this.abortStream(ctx.id);

    const ac = new AbortController();
    this.streamAbortByCamera.set(ctx.id, ac);

    const url = this.buildSnapUrl(ctx.host);
    const auth = new AxiosDigestAuth({
      username: ctx.username,
      password: ctx.passwordPlain,
    });

    this.logger.log(`[LprListener] snapManager "${ctx.name}" → ${url}`);

    auth
      .request({
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 0,
        signal: ac.signal,
      })
      .then((response) => {
        if (this.connectGeneration.get(ctx.id) !== gen) return;

        this.streamCtxByCamera.set(ctx.id, ctx);
        this.snapMultipartByCamera.set(ctx.id, createSnapMultipartState());

        this.updateStatus(ctx.id, {
          connected: true,
          connectedSince: new Date(),
          lastConnectionError: undefined,
        });

        const stream = response.data as Readable;

        stream.on('data', (chunk: Buffer) => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.processSnapChunk(chunk, ctx);
        });

        stream.on('end', () => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.finalizeSnapPending(ctx.id);
          this.updateStatus(ctx.id, { connected: false });
          this.scheduleReconnect(ctx.id, 5_000);
        });

        stream.on('error', (err: Error) => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.finalizeSnapPending(ctx.id);
          this.updateStatus(ctx.id, {
            connected: false,
            lastConnectionError: err.message,
          });
          this.scheduleReconnect(ctx.id, 5_000);
        });
      })
      .catch((err: Error) => {
        if (this.connectGeneration.get(ctx.id) !== gen) return;
        if (ac.signal.aborted) return;
        this.logger.warn(
          `[LprListener] snapManager falhou "${ctx.name}": ${err.message}`,
        );
        this.updateStatus(ctx.id, {
          connected: false,
          lastConnectionError: err.message,
        });
        this.scheduleReconnect(ctx.id, 30_000);
      });
  }

  private processSnapChunk(chunk: Buffer, ctx: CameraStreamContext): void {
    let state = this.snapMultipartByCamera.get(ctx.id);
    if (!state) {
      state = createSnapMultipartState();
      this.snapMultipartByCamera.set(ctx.id, state);
    }

    const parts = feedSnapMultipart(state, chunk);

    for (const part of parts) {
      const ct = part.contentType.toLowerCase();

      if (ct.startsWith('text/')) {
        const map = parseSnapManagerTextPart(part.body.toString('latin1'));

        const lr = snapFlatMapToLprReading(map);

        if (!lr || !this.isPersistableSnap(map, lr)) {
          if (map.size > 0) {
            this.discardIncompletePending(ctx.id);
          }
          continue;
        }

        const prev = this.snapPendingByCamera.get(ctx.id);
        const nextEventId = lr.correlationEventId?.trim() ?? '';

        if (prev?.reading && this.isFlushableReading(prev.reading)) {
          const prevEventId = prev.reading.correlationEventId?.trim() ?? '';
          const sameEvent =
            prevEventId !== '' &&
            nextEventId !== '' &&
            prevEventId === nextEventId;

          if (!sameEvent && prev.images.length > 0) {
            this.tryFlushSnapPending(ctx.id);
          } else if (!sameEvent) {
            this.snapPendingByCamera.delete(ctx.id);
          }
        }

        const afterPrev = this.snapPendingByCamera.get(ctx.id);
        const keepImages =
          afterPrev?.reading?.correlationEventId?.trim() === nextEventId &&
          nextEventId !== '' &&
          afterPrev.images.length > 0;

        const next = this.getOrCreateSnapPending(ctx.id);
        next.reading = lr;
        next.slices = collectImageSlices(map);
        next.images = keepImages && afterPrev ? afterPrev.images : [];
        this.tryFlushSnapPending(ctx.id);
      } else if (ct.startsWith('image/')) {
        const pend = this.snapPendingByCamera.get(ctx.id);
        if (!pend?.reading || !this.isFlushableReading(pend.reading)) {
          continue;
        }
        pend.images.push(part.body);
        this.updateStatus(ctx.id, {
          eventsReceived: (this.statuses.get(ctx.id)?.eventsReceived ?? 0) + 1,
          lastEventAt: new Date(),
        });
        this.scheduleLastSeen(ctx.id);
        this.tryFlushSnapPending(ctx.id);
      }
    }
  }

  private scheduleLastSeen(cameraId: string): void {
    const prev = this.lastSeenDebounceTimers.get(cameraId);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(() => {
      this.lastSeenDebounceTimers.delete(cameraId);
      const at = new Date();
      void camerasQueries
        .updateCameraLastSeenAt(this.database.db, cameraId, at)
        .catch(() => {});
    }, LprListenerService.LAST_SEEN_DEBOUNCE_MS);

    this.lastSeenDebounceTimers.set(cameraId, timer);
  }
}
