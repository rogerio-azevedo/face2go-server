import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import AxiosDigestAuth from '@mhoc/axios-digest-auth';
import { Readable } from 'node:stream';

import type { EnvVars } from '../config/env.validation';
import {
  createReaderCredentialsCipher,
  type ReaderCredentialsCipher,
} from '../common/crypto/reader-credentials.cipher';
import { DatabaseService } from '../database/database.service';
import { AccessesService } from '../accesses/accesses.service';
import type {
  ReaderBrand,
  ReaderDirection,
  ReaderEventStreamRow,
} from '../database/queries/readers.queries';
import * as readersQueries from '../database/queries/readers.queries';
import {
  hikvisionAlertStreamUrl,
  hikvisionEventToVideoEvent,
  hikvisionIsapiRequest,
  hikvisionOpenStreamRequest,
  hikvisionProbeAlertStreamSupported,
  hikvisionSearchAcsEvents,
  parseHikvisionAlertStreamPart,
  toHikvisionConnection,
} from '../integrations/hikvision';
import type {
  ReaderListenerStatus,
  ReaderMonitorDeviceRow,
  ReaderMonitorStatusReport,
  ReaderBrandSlug,
  VideoEvent,
} from './face-listener.types';
import {
  createSnapMultipartState,
  type SnapMultipartAccumState,
} from './snap-buffer-state.type';
import type { SnapImageSliceMeta } from './snap-stream.parser';
import {
  collectImageSlices,
  feedSnapMultipart,
  parseSnapManagerTextPart,
  sliceSnapJpeg,
  snapFlatMapToVideoEvent,
} from './snap-stream.parser';
import {
  createMultipartState,
  extractBoundaryFromContentType,
  feedMultipartStream,
  type MultipartAccumState,
} from './hikvision-multipart-json.parser';
import {
  extractHttpStatus,
  HIKVISION_CONNECT_STAGGER_MS,
  HIKVISION_POLL_OFFLINE_THRESHOLD,
  type HikvisionMonitorMode,
  nextPollFailCountOnError,
  shouldFallbackAlertStreamToPoll,
  shouldLogPollFailure,
  shouldMarkPollOffline,
} from './face-listener-hikvision-monitor.util';
import { READER_OFFLINE_DETECTED } from './face-listener.events';
import {
  decideOfflineNotifyAction,
  DEFAULT_READER_OFFLINE_NOTIFY_DEBOUNCE_MS,
  shouldEmitOfflineNotification,
} from './face-listener-offline-notifier.util';

type FacialSnapEvent = NonNullable<ReturnType<typeof snapFlatMapToVideoEvent>>;

/** Registro em memória para stream + digest (senha só em RAM). */
type ReaderStreamContext = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  companyId: string;
  brand: ReaderBrand;
  direction: ReaderDirection | null;
  host: string;
  username: string;
  passwordPlain: string;
};

function hostFromIpPort(ip: string, port: number): string {
  return `${ip.trim()}:${port}`;
}

function toBrandSlug(brand: ReaderBrand): ReaderBrandSlug {
  return brand === 'hikvision' ? 'hikvision' : 'intelbras';
}

type SnapPending = {
  event: FacialSnapEvent | null;
  image: Buffer | null;
  slices: SnapImageSliceMeta[];
};

function toStreamContext(
  row: ReaderEventStreamRow,
  cipher: ReaderCredentialsCipher,
): ReaderStreamContext | undefined {
  try {
    const passwordPlain = cipher.decrypt(row.passwordEncrypted);
    return {
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      clientName: row.clientName,
      companyId: row.companyId,
      brand: row.brand,
      direction: row.direction ?? null,
      host: hostFromIpPort(row.ip, row.port),
      username: row.username.trim(),
      passwordPlain,
    };
  } catch (err) {
    Logger.warn(
      `[FaceListener] Senha inválida ou não descriptografável — leitor "${row.name}" (${row.id}) ignorado`,
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }
}

@Injectable()
export class FaceListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FaceListenerService.name);

  private readonly cipher: ReaderCredentialsCipher;

  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private hikvisionPollTimers = new Map<string, NodeJS.Timeout>();
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;

  private streamAbortByReader = new Map<string, AbortController>();
  private connectGeneration = new Map<string, number>();

  private multipartByReader = new Map<string, SnapMultipartAccumState>();
  private hikvisionMultipartByReader = new Map<string, MultipartAccumState>();
  private pendingByReader = new Map<string, SnapPending>();
  private hikvisionLastSerialByReader = new Map<string, number>();
  private processedHikvisionEventKeys = new Map<string, number>();
  private hikvisionIntegrationByReader = new Map<
    string,
    HikvisionMonitorMode
  >();
  private hikvisionPollFailCountByReader = new Map<string, number>();
  private hikvisionAlertStreamFailCountByReader = new Map<string, number>();
  private offlineNotifyTimers = new Map<string, NodeJS.Timeout>();
  private offlineNotifiedAt = new Map<string, Date>();
  private readonly offlineNotifyDebounceMs: number;

  private static readonly REFRESH_INTERVAL_MS = 60_000;
  private static readonly LAST_SEEN_DEBOUNCE_MS = 30_000;
  private static readonly HIKVISION_POLL_INTERVAL_MS = 3_000;
  private static readonly HIKVISION_EVENT_DEDUP_MS = 5 * 60_000;

  private statuses = new Map<string, ReaderListenerStatus>();
  private lastSeenDebounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly accessesService: AccessesService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const key = this.configService.get('READER_ENCRYPTION_KEY', {
      infer: true,
    });

    this.cipher = createReaderCredentialsCipher(key);
    this.offlineNotifyDebounceMs =
      this.configService.get('READER_OFFLINE_NOTIFY_DEBOUNCE_MS', {
        infer: true,
      }) ?? DEFAULT_READER_OFFLINE_NOTIFY_DEBOUNCE_MS;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connectAllStreamReaders();
    } catch (err) {
      this.logger.error(
        `[FaceListener] Init falhou (app segue sem escutar leitores): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
    this.refreshIntervalId = setInterval(() => {
      void this.refreshConnections().catch((e) =>
        this.logger.warn(
          `[FaceListener] Refresh falhou: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }, FaceListenerService.REFRESH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    for (const timer of this.hikvisionPollTimers.values()) {
      clearInterval(timer);
    }
    this.hikvisionPollTimers.clear();
    for (const timer of this.lastSeenDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.lastSeenDebounceTimers.clear();
    for (const timer of this.offlineNotifyTimers.values()) {
      clearTimeout(timer);
    }
    this.offlineNotifyTimers.clear();
    this.offlineNotifiedAt.clear();
    for (const id of this.streamAbortByReader.keys()) {
      this.streamAbortByReader.get(id)?.abort();
    }
    this.streamAbortByReader.clear();
  }

  /**
   * Status agregado para uma empresa (REST). Mescla leitores do banco + estado in-memory do stream.
   */
  async getMonitorReportForCompany(
    companyId: string,
    filterClientId?: string,
  ): Promise<ReaderMonitorStatusReport> {
    const fromDb = await readersQueries.listReadersForMonitorReport(
      this.database.db,
      companyId,
      filterClientId,
    );

    const devices: ReaderMonitorDeviceRow[] = fromDb.map((d) => {
      const host = hostFromIpPort(d.ip, d.port);
      const existing = this.statuses.get(d.id);
      const streamSupported =
        (d.brand === 'intelbras' || d.brand === 'hikvision') &&
        d.hasCredentials &&
        d.isActive;

      const base: ReaderMonitorDeviceRow = {
        readerId: d.id,
        readerName: d.name,
        clientName: d.clientName,
        brand: toBrandSlug(d.brand),
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
        return {
          ...base,
          lastConnectionError: !d.isActive
            ? 'Leitor inativo'
            : d.brand !== 'intelbras' && d.brand !== 'hikvision'
              ? 'Monitoramento de stream ainda não suportado para esta marca'
              : !d.hasCredentials
                ? 'Credenciais do leitor não configuradas'
                : null,
        };
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

  private async connectAllStreamReaders(): Promise<void> {
    const rows = await readersQueries.listReadersForEventStream(
      this.database.db,
    );

    const valid: ReaderStreamContext[] = [];
    for (const row of rows) {
      const ctx = toStreamContext(row, this.cipher);
      if (!ctx) {
        this.logger.warn(
          `[FaceListener] Senha inválida ou não descriptografável — leitor "${row.name}" (${row.id}) ignorado`,
        );
        continue;
      }
      valid.push(ctx);
    }

    if (valid.length === 0) {
      this.logger.warn(
        'Nenhum leitor ativo com credenciais — streams não iniciados',
      );
      return;
    }

    this.logger.log(
      `[FaceListener] Iniciando streams em ${valid.length} leitor(es)...`,
    );

    let hikvisionConnectIndex = 0;
    for (const ctx of valid) {
      this.statuses.set(ctx.id, {
        readerId: ctx.id,
        readerName: ctx.name,
        clientId: ctx.clientId,
        clientName: ctx.clientName,
        companyId: ctx.companyId,
        brand: toBrandSlug(ctx.brand),
        host: ctx.host,
        connected: false,
        eventsReceived: 0,
      });

      if (ctx.brand === 'hikvision') {
        const delayMs = hikvisionConnectIndex * HIKVISION_CONNECT_STAGGER_MS;
        hikvisionConnectIndex += 1;
        if (delayMs > 0) {
          setTimeout(() => this.subscribe(ctx), delayMs);
        } else {
          this.subscribe(ctx);
        }
        continue;
      }

      this.subscribe(ctx);
    }
  }

  async refreshConnections(): Promise<void> {
    const rows = await readersQueries.listReadersForEventStream(
      this.database.db,
    );

    const validContexts: ReaderStreamContext[] = [];
    for (const row of rows) {
      const ctx = toStreamContext(row, this.cipher);
      if (!ctx) continue;
      validContexts.push(ctx);
    }

    const validIds = new Set(validContexts.map((c) => c.id));

    for (const id of [...this.statuses.keys()]) {
      if (!validIds.has(id)) {
        this.teardownReader(id, 'removido ou sem credenciais / inativo');
      }
    }

    for (const ctx of validContexts) {
      const dbHost = ctx.host;
      const existing = this.statuses.get(ctx.id);

      if (!existing) {
        this.statuses.set(ctx.id, {
          readerId: ctx.id,
          readerName: ctx.name,
          clientId: ctx.clientId,
          clientName: ctx.clientName,
          companyId: ctx.companyId,
          brand: toBrandSlug(ctx.brand),
          host: dbHost,
          connected: false,
          eventsReceived: 0,
        });
        this.logger.log(
          `[FaceListener] Novo leitor: "${ctx.name}" → ${dbHost}`,
        );
        this.subscribe(ctx);
        continue;
      }

      const memHost = String(existing.host ?? '').trim();
      if (memHost !== dbHost) {
        this.logger.log(
          `[FaceListener] Host alterado "${ctx.name}" (${memHost} → ${dbHost}) — reconectando`,
        );
        this.clearReconnectTimer(ctx.id);
        this.abortStream(ctx.id);
        this.updateStatus(ctx.id, {
          readerName: ctx.name,
          host: dbHost,
          clientName: ctx.clientName,
          connected: false,
          connectedSince: undefined,
          lastConnectionError: undefined,
        });
        this.subscribe(ctx);
      } else {
        this.updateStatus(ctx.id, {
          readerName: ctx.name,
          clientName: ctx.clientName,
        });
      }
    }
  }

  private bumpConnectGeneration(readerId: string): number {
    const n = (this.connectGeneration.get(readerId) ?? 0) + 1;
    this.connectGeneration.set(readerId, n);
    return n;
  }

  private clearReconnectTimer(readerId: string): void {
    const t = this.reconnectTimers.get(readerId);
    if (t) clearTimeout(t);
    this.reconnectTimers.delete(readerId);
  }

  private scheduleReconnect(readerId: string, delayMs: number): void {
    this.clearReconnectTimer(readerId);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(readerId);
      void this.subscribeFromDb(readerId);
    }, delayMs);
    this.reconnectTimers.set(readerId, timer);
  }

  private async subscribeFromDb(readerId: string): Promise<void> {
    const row = await readersQueries.getReaderForEventStreamById(
      this.database.db,
      readerId,
    );
    if (!row) {
      this.logger.warn(
        `[FaceListener] Reconexão ignorada — ${readerId} indisponível para stream`,
      );
      this.teardownReader(readerId, 'sem dados elegíveis no banco');
      return;
    }

    const ctx = toStreamContext(row, this.cipher);
    if (!ctx) {
      this.logger.warn(
        `[FaceListener] Reconexão ignorada — credencial inválida (${readerId})`,
      );
      return;
    }

    if (!this.statuses.has(readerId)) {
      this.statuses.set(readerId, {
        readerId: row.id,
        readerName: row.name,
        clientId: row.clientId,
        clientName: row.clientName,
        companyId: row.companyId,
        brand: toBrandSlug(row.brand),
        host: ctx.host,
        connected: false,
        eventsReceived: 0,
      });
    } else {
      this.updateStatus(readerId, {
        readerName: row.name,
        host: ctx.host,
        clientName: row.clientName,
      });
    }
    this.clearReconnectTimer(readerId);
    this.subscribe(ctx);
  }

  private abortStream(readerId: string): void {
    const ac = this.streamAbortByReader.get(readerId);
    if (ac) {
      ac.abort();
      this.streamAbortByReader.delete(readerId);
    }
  }

  private clearHikvisionPollTimer(readerId: string): void {
    const t = this.hikvisionPollTimers.get(readerId);
    if (t) clearInterval(t);
    this.hikvisionPollTimers.delete(readerId);
  }

  private teardownReader(readerId: string, reason: string): void {
    this.logger.log(`[FaceListener] Encerrando stream ${readerId}: ${reason}`);
    this.clearReconnectTimer(readerId);
    this.clearHikvisionPollTimer(readerId);
    this.bumpConnectGeneration(readerId);
    this.abortStream(readerId);
    this.multipartByReader.delete(readerId);
    this.hikvisionMultipartByReader.delete(readerId);
    this.pendingByReader.delete(readerId);
    this.hikvisionLastSerialByReader.delete(readerId);
    this.hikvisionIntegrationByReader.delete(readerId);
    this.hikvisionPollFailCountByReader.delete(readerId);
    this.hikvisionAlertStreamFailCountByReader.delete(readerId);
    const t = this.lastSeenDebounceTimers.get(readerId);
    if (t) clearTimeout(t);
    this.lastSeenDebounceTimers.delete(readerId);
    this.clearOfflineNotifyTimer(readerId);
    this.offlineNotifiedAt.delete(readerId);
    this.statuses.delete(readerId);
  }

  private subscribe(ctx: ReaderStreamContext): void {
    if (ctx.brand === 'hikvision') {
      void this.subscribeHikvision(ctx);
      return;
    }
    this.subscribeIntelbras(ctx);
  }

  private buildSnapUrl(host: string): string {
    return (
      `http://${host}/cgi-bin/snapManager.cgi` +
      `?action=attachFileProc&Flags[0]=Event&Events=[All]&heartbeat=5`
    );
  }

  private subscribeIntelbras(ctx: ReaderStreamContext): void {
    const gen = this.bumpConnectGeneration(ctx.id);
    this.abortStream(ctx.id);

    const ac = new AbortController();
    this.streamAbortByReader.set(ctx.id, ac);

    const url = this.buildSnapUrl(ctx.host);
    const auth = new AxiosDigestAuth({
      username: ctx.username,
      password: ctx.passwordPlain,
    });

    this.updateStatus(ctx.id, {
      readerName: ctx.name,
      host: ctx.host,
      clientName: ctx.clientName,
    });

    this.logger.log(`[FaceListener] snapManager "${ctx.name}" → ${url}`);

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

        this.logger.log(
          `[FaceListener] snapManager conectado "${ctx.name}" — aguardando eventos+capturas`,
        );

        this.multipartByReader.set(ctx.id, createSnapMultipartState());
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
          this.logger.warn(
            `[FaceListener] snapManager stream encerrada: "${ctx.name}". Reconectando em 5s...`,
          );
          this.pendingByReader.delete(ctx.id);
          this.updateStatus(ctx.id, {
            connected: false,
            lastConnectionError: 'Stream encerrada pelo leitor',
          });
          this.scheduleReconnect(ctx.id, 5_000);
        });

        stream.on('error', (err: Error) => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.logger.error(
            `[FaceListener] Erro snapManager "${ctx.name}": ${err.message}`,
          );
          this.pendingByReader.delete(ctx.id);
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
          `[FaceListener] snapManager falhou "${ctx.name}": ${err.message}`,
        );
        this.updateStatus(ctx.id, {
          connected: false,
          lastConnectionError: err.message,
        });
        this.scheduleReconnect(ctx.id, 30_000);
      });
  }

  private getOrCreateSnapPending(readerId: string): SnapPending {
    let p = this.pendingByReader.get(readerId);
    if (!p) {
      p = { event: null, image: null, slices: [] };
      this.pendingByReader.set(readerId, p);
    }
    return p;
  }

  /** Descarta pending só com imagem órfã (sem evento AccessControl válido). */
  private discardOrphanImagePending(readerId: string): void {
    const pend = this.pendingByReader.get(readerId);
    if (!pend) return;
    if (pend.event) return;
    this.pendingByReader.delete(readerId);
  }

  private tryFlushSnapPending(
    readerId: string,
    ctx: ReaderStreamContext,
  ): void {
    const p = this.pendingByReader.get(readerId);
    if (!p?.event || !p.image) {
      return;
    }
    const ev = p.event;
    const rawImg = p.image;
    const slices = p.slices;
    p.event = null;
    p.image = null;
    p.slices = [];

    const jpeg = sliceSnapJpeg(rawImg, slices);
    const persist = async (): Promise<void> => {
      try {
        await this.accessesService.recordSnapManagerAccess(ev, ctx, jpeg);
        this.updateStatus(readerId, {
          eventsReceived:
            (this.statuses.get(readerId)?.eventsReceived ?? 0) + 1,
          lastEventAt: new Date(),
        });
        this.scheduleLastSeenPersist(readerId);
      } catch (err: unknown) {
        this.logger.warn(
          `[FaceListener] Persistência snap falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };
    void persist();
  }

  private processSnapChunk(chunk: Buffer, ctx: ReaderStreamContext): void {
    let state = this.multipartByReader.get(ctx.id);
    if (!state) {
      state = createSnapMultipartState();
      this.multipartByReader.set(ctx.id, state);
    }

    const parts = feedSnapMultipart(state, chunk);

    for (const part of parts) {
      const ct = part.contentType.toLowerCase();
      if (ct.startsWith('text/')) {
        const map = parseSnapManagerTextPart(part.body.toString('latin1'));
        if (map.size === 0) {
          continue;
        }
        const evt = snapFlatMapToVideoEvent(map);
        if (evt) {
          const pend = this.getOrCreateSnapPending(ctx.id);
          pend.event = evt;
          pend.slices = collectImageSlices(map);
          this.tryFlushSnapPending(ctx.id, ctx);
        } else if (map.size > 0) {
          this.discardOrphanImagePending(ctx.id);
        }
      } else if (ct.startsWith('image/')) {
        const pend = this.pendingByReader.get(ctx.id);
        if (!pend?.event) {
          continue;
        }
        pend.image = part.body;
        this.tryFlushSnapPending(ctx.id, ctx);
      }
    }
  }

  private async subscribeHikvision(ctx: ReaderStreamContext): Promise<void> {
    const gen = this.bumpConnectGeneration(ctx.id);
    this.abortStream(ctx.id);
    this.clearHikvisionPollTimer(ctx.id);

    const connection = toHikvisionConnection({
      id: ctx.id,
      name: ctx.name,
      ip: ctx.host.split(':')[0] ?? ctx.host,
      port: Number(ctx.host.split(':')[1] ?? 80),
      username: ctx.username,
      plainPassword: ctx.passwordPlain,
    });

    const persistedMode = this.hikvisionIntegrationByReader.get(ctx.id);
    if (persistedMode === 'acsEventPoll') {
      if (this.connectGeneration.get(ctx.id) !== gen) return;
      this.subscribeHikvisionPoll(ctx, connection, gen);
      return;
    }
    if (persistedMode === 'alertStream') {
      if (this.connectGeneration.get(ctx.id) !== gen) return;
      this.subscribeHikvisionAlertStream(ctx, connection, gen);
      return;
    }

    let useAlertStream = false;
    try {
      useAlertStream = await hikvisionProbeAlertStreamSupported(connection);
    } catch (err: unknown) {
      this.logger.warn(
        `[FaceListener] Probe alertStream falhou "${ctx.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (this.connectGeneration.get(ctx.id) !== gen) return;

    if (useAlertStream) {
      this.hikvisionIntegrationByReader.set(ctx.id, 'alertStream');
      this.subscribeHikvisionAlertStream(ctx, connection, gen);
    } else {
      this.hikvisionIntegrationByReader.set(ctx.id, 'acsEventPoll');
      this.subscribeHikvisionPoll(ctx, connection, gen);
    }
  }

  private fallbackHikvisionToPoll(
    ctx: ReaderStreamContext,
    connection: ReturnType<typeof toHikvisionConnection>,
    gen: number,
    reason: string,
  ): void {
    if (this.connectGeneration.get(ctx.id) !== gen) return;

    this.logger.warn(
      `[FaceListener] alertStream → acsEventPoll "${ctx.name}": ${reason}`,
    );
    this.hikvisionIntegrationByReader.set(ctx.id, 'acsEventPoll');
    this.hikvisionAlertStreamFailCountByReader.delete(ctx.id);
    this.clearReconnectTimer(ctx.id);
    this.abortStream(ctx.id);
    this.subscribeHikvisionPoll(ctx, connection, gen);
  }

  private recordAlertStreamFailure(
    ctx: ReaderStreamContext,
    connection: ReturnType<typeof toHikvisionConnection>,
    gen: number,
    err: unknown,
  ): void {
    if (this.connectGeneration.get(ctx.id) !== gen) return;

    const httpStatus = extractHttpStatus(err);
    const fails =
      (this.hikvisionAlertStreamFailCountByReader.get(ctx.id) ?? 0) + 1;
    this.hikvisionAlertStreamFailCountByReader.set(ctx.id, fails);

    const message = err instanceof Error ? err.message : String(err);
    if (
      shouldFallbackAlertStreamToPoll({
        httpStatus,
        consecutiveFailures: fails,
      })
    ) {
      this.fallbackHikvisionToPoll(
        ctx,
        connection,
        gen,
        httpStatus === 404
          ? 'alertStream retornou 404'
          : `${fails} falhas consecutivas (${message})`,
      );
      return;
    }

    this.updateStatus(ctx.id, {
      connected: false,
      lastConnectionError: message,
    });
    this.scheduleReconnect(ctx.id, httpStatus === 404 ? 5_000 : 10_000);
  }

  private subscribeHikvisionAlertStream(
    ctx: ReaderStreamContext,
    connection: ReturnType<typeof toHikvisionConnection>,
    gen: number,
  ): void {
    const ac = new AbortController();
    this.streamAbortByReader.set(ctx.id, ac);
    const url = hikvisionAlertStreamUrl(connection);

    this.updateStatus(ctx.id, {
      readerName: ctx.name,
      host: ctx.host,
      clientName: ctx.clientName,
    });

    this.logger.log(
      `[FaceListener] alertStream Hikvision "${ctx.name}" → ${url}`,
    );

    hikvisionOpenStreamRequest(connection, url, ac.signal)
      .then((response) => {
        if (this.connectGeneration.get(ctx.id) !== gen) return;

        const contentType = String(response.headers?.['content-type'] ?? '');
        const boundary = extractBoundaryFromContentType(contentType);
        this.hikvisionMultipartByReader.set(
          ctx.id,
          createMultipartState(boundary),
        );

        this.logger.log(
          `[FaceListener] alertStream conectado "${ctx.name}" — aguardando eventos`,
        );

        this.updateStatus(ctx.id, {
          connected: true,
          connectedSince: new Date(),
          lastConnectionError: undefined,
        });
        this.hikvisionAlertStreamFailCountByReader.set(ctx.id, 0);

        const stream = response.data as Readable;
        stream.on('data', (chunk: Buffer) => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.processHikvisionAlertChunk(chunk, ctx, connection);
        });

        stream.on('end', () => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.logger.warn(
            `[FaceListener] alertStream encerrada: "${ctx.name}". Reconectando em 5s...`,
          );
          this.recordAlertStreamFailure(
            ctx,
            connection,
            gen,
            new Error('Stream encerrada pelo leitor'),
          );
        });

        stream.on('error', (err: Error) => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.logger.error(
            `[FaceListener] Erro alertStream "${ctx.name}": ${err.message}`,
          );
          this.recordAlertStreamFailure(ctx, connection, gen, err);
        });
      })
      .catch((err: Error) => {
        if (this.connectGeneration.get(ctx.id) !== gen) return;
        if (ac.signal.aborted) return;
        this.logger.warn(
          `[FaceListener] alertStream falhou "${ctx.name}": ${err.message}`,
        );
        this.recordAlertStreamFailure(ctx, connection, gen, err);
      });
  }

  private subscribeHikvisionPoll(
    ctx: ReaderStreamContext,
    connection: ReturnType<typeof toHikvisionConnection>,
    gen: number,
  ): void {
    this.logger.log(
      `[FaceListener] acsEventPoll Hikvision "${ctx.name}" — intervalo ${FaceListenerService.HIKVISION_POLL_INTERVAL_MS}ms`,
    );

    this.updateStatus(ctx.id, {
      connected: true,
      connectedSince: new Date(),
      lastConnectionError: undefined,
    });
    this.hikvisionPollFailCountByReader.set(ctx.id, 0);

    const poll = async (): Promise<void> => {
      if (this.connectGeneration.get(ctx.id) !== gen) return;

      try {
        const lastSerial = this.hikvisionLastSerialByReader.get(ctx.id);
        const events = await hikvisionSearchAcsEvents(connection, {
          maxResults: 30,
          lookbackMs: 10 * 60 * 1000,
          timeReverseOrder: true,
        });

        this.hikvisionPollFailCountByReader.set(ctx.id, 0);
        this.updateStatus(ctx.id, {
          connected: true,
          lastConnectionError: undefined,
        });

        if (events.length === 0) return;

        const sorted = [...events].sort(
          (a, b) => (a.serialNo ?? 0) - (b.serialNo ?? 0),
        );

        if (lastSerial == null) {
          const maxInBatch = sorted.reduce(
            (max, evt) => Math.max(max, evt.serialNo ?? 0),
            0,
          );
          if (maxInBatch > 0) {
            this.hikvisionLastSerialByReader.set(ctx.id, maxInBatch);
          }
          return;
        }

        let maxSerial = lastSerial;
        for (const event of sorted) {
          const serial = event.serialNo;
          if (serial != null && serial <= lastSerial) {
            continue;
          }
          await this.handleHikvisionAccessEvent(ctx, connection, event);
          if (serial != null) {
            maxSerial = Math.max(maxSerial, serial);
          }
        }

        if (maxSerial > lastSerial) {
          this.hikvisionLastSerialByReader.set(ctx.id, maxSerial);
        }
      } catch (err: unknown) {
        const fails = nextPollFailCountOnError(
          this.hikvisionPollFailCountByReader.get(ctx.id) ?? 0,
        );
        this.hikvisionPollFailCountByReader.set(ctx.id, fails);
        const message = err instanceof Error ? err.message : String(err);
        if (shouldLogPollFailure(fails)) {
          this.logger.warn(
            `[FaceListener] acsEventPoll falhou "${ctx.name}" (${fails}/${HIKVISION_POLL_OFFLINE_THRESHOLD}): ${message}`,
          );
        }
        if (shouldMarkPollOffline(fails)) {
          this.updateStatus(ctx.id, {
            connected: false,
            lastConnectionError: message,
          });
        }
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, FaceListenerService.HIKVISION_POLL_INTERVAL_MS);
    this.hikvisionPollTimers.set(ctx.id, timer);
  }

  private processHikvisionAlertChunk(
    chunk: Buffer,
    ctx: ReaderStreamContext,
    connection: ReturnType<typeof toHikvisionConnection>,
  ): void {
    let state = this.hikvisionMultipartByReader.get(ctx.id);
    if (!state) {
      state = createMultipartState('myboundary');
      this.hikvisionMultipartByReader.set(ctx.id, state);
    }

    const parts = feedMultipartStream(state, chunk);
    for (const part of parts) {
      const ct = part.contentType.toLowerCase();
      if (!ct.includes('json') && !ct.startsWith('text/')) {
        continue;
      }
      const event = parseHikvisionAlertStreamPart(part.body);
      if (!event) continue;
      void this.handleHikvisionAccessEvent(ctx, connection, event);
    }
  }

  private async handleHikvisionAccessEvent(
    ctx: ReaderStreamContext,
    connection: ReturnType<typeof toHikvisionConnection>,
    event: Parameters<typeof hikvisionEventToVideoEvent>[0],
  ): Promise<void> {
    const dedupKey = `${ctx.id}:${event.serialNo ?? event.employeeNoString}:${event.time ?? ''}`;
    const now = Date.now();
    const prev = this.processedHikvisionEventKeys.get(dedupKey);
    if (prev && now - prev < FaceListenerService.HIKVISION_EVENT_DEDUP_MS) {
      return;
    }
    this.processedHikvisionEventKeys.set(dedupKey, now);

    const videoEvent: VideoEvent = hikvisionEventToVideoEvent(event);
    const data = videoEvent.data;
    if (!data) return;

    const similarity = data.Similarity;
    const similarityNum =
      typeof similarity === 'number'
        ? similarity
        : similarity != null && String(similarity).trim() !== ''
          ? Number(similarity)
          : NaN;
    if (!Number.isFinite(similarityNum) || similarityNum <= 0) {
      return;
    }
    if (data.Status != null && data.Status !== 1) {
      return;
    }

    let imageJpeg: Buffer | null = null;
    const pictureUrl =
      typeof data.SnapPath === 'string' ? data.SnapPath.trim() : '';
    if (pictureUrl) {
      const absoluteUrl = pictureUrl.startsWith('http')
        ? pictureUrl
        : `${connection.baseUrl}${pictureUrl.startsWith('/') ? '' : '/'}${pictureUrl}`;
      try {
        const imageResponse = await hikvisionIsapiRequest(connection, {
          method: 'GET',
          url: absoluteUrl,
          responseType: 'arraybuffer',
        });
        const raw = imageResponse.data;
        if (raw instanceof Buffer) {
          imageJpeg = raw;
        } else if (raw instanceof ArrayBuffer) {
          imageJpeg = Buffer.from(raw);
        }
      } catch (err: unknown) {
        this.logger.debug(
          `[FaceListener] Snapshot Hikvision falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    try {
      await this.accessesService.recordSnapManagerAccess(
        videoEvent,
        ctx,
        imageJpeg,
      );
      this.updateStatus(ctx.id, {
        eventsReceived: (this.statuses.get(ctx.id)?.eventsReceived ?? 0) + 1,
        lastEventAt: new Date(),
      });
      this.scheduleLastSeenPersist(ctx.id);
    } catch (err: unknown) {
      this.logger.warn(
        `[FaceListener] Persistência Hikvision falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private scheduleLastSeenPersist(readerId: string): void {
    const existing = this.lastSeenDebounceTimers.get(readerId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.lastSeenDebounceTimers.delete(readerId);
      const at = new Date();
      void readersQueries
        .updateReaderLastSeenAt(this.database.db, readerId, at)
        .catch((err: unknown) => {
          this.logger.warn(
            `[FaceListener] lastSeenAt falhou (${readerId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }, FaceListenerService.LAST_SEEN_DEBOUNCE_MS);

    this.lastSeenDebounceTimers.set(readerId, timer);
  }

  private updateStatus(
    readerId: string,
    partial: Partial<ReaderListenerStatus>,
  ): void {
    const current = this.statuses.get(readerId);
    if (!current) return;

    const next: ReaderListenerStatus = { ...current, ...partial };
    this.statuses.set(readerId, next);

    if (partial.connected === undefined) return;

    const action = decideOfflineNotifyAction({
      previousConnected: current.connected,
      nextConnected: next.connected,
      alreadyNotified: this.offlineNotifiedAt.has(readerId),
      hasPendingTimer: this.offlineNotifyTimers.has(readerId),
    });

    if (action === 'cancel') {
      this.clearOfflineNotifyTimer(readerId);
      this.offlineNotifiedAt.delete(readerId);
      return;
    }

    if (action === 'schedule') {
      this.scheduleOfflineNotify(readerId);
    }
  }

  private clearOfflineNotifyTimer(readerId: string): void {
    const timer = this.offlineNotifyTimers.get(readerId);
    if (timer) clearTimeout(timer);
    this.offlineNotifyTimers.delete(readerId);
  }

  private scheduleOfflineNotify(readerId: string): void {
    this.clearOfflineNotifyTimer(readerId);
    const timer = setTimeout(() => {
      this.offlineNotifyTimers.delete(readerId);
      this.emitOfflineIfStillDown(readerId);
    }, this.offlineNotifyDebounceMs);
    this.offlineNotifyTimers.set(readerId, timer);
  }

  private emitOfflineIfStillDown(readerId: string): void {
    const status = this.statuses.get(readerId);
    if (!status) return;
    if (
      !shouldEmitOfflineNotification({
        currentlyConnected: status.connected,
        alreadyNotified: this.offlineNotifiedAt.has(readerId),
      })
    ) {
      return;
    }

    this.offlineNotifiedAt.set(readerId, new Date());
    this.eventEmitter.emit(READER_OFFLINE_DETECTED, {
      readerId,
      readerName: status.readerName,
      clientId: status.clientId,
      clientName: status.clientName,
      companyId: status.companyId,
      brand: status.brand,
      lastConnectionError: status.lastConnectionError,
      detectedAt: new Date(),
    });
    this.logger.warn(
      `[FaceListener] Leitor offline persistente: "${status.readerName}" (${readerId}) client=${status.clientName}`,
    );
  }
}
