import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  ReaderEventStreamRow,
} from '../database/queries/readers.queries';
import * as readersQueries from '../database/queries/readers.queries';
import type {
  ReaderListenerStatus,
  ReaderMonitorDeviceRow,
  ReaderMonitorStatusReport,
  ReaderBrandSlug,
} from './face-listener.types';
import {
  parseVideoEventLine,
  parseVideoEventPayload,
} from './video-stream.parser';

/** Registro em memória para stream + digest (senha só em RAM). */
type ReaderStreamContext = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  companyId: string;
  brand: ReaderBrand;
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

  private buffers = new Map<string, string>();
  private partBuffers = new Map<string, string[]>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private refreshIntervalId: ReturnType<typeof setInterval> | null = null;

  private streamAbortByReader = new Map<string, AbortController>();
  private connectGeneration = new Map<string, number>();

  private static readonly REFRESH_INTERVAL_MS = 60_000;
  private static readonly LAST_SEEN_DEBOUNCE_MS = 30_000;

  private statuses = new Map<string, ReaderListenerStatus>();
  private lastSeenDebounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly accessesService: AccessesService,
  ) {
    const key = this.configService.get('READER_ENCRYPTION_KEY', {
      infer: true,
    });

    this.cipher = createReaderCredentialsCipher(key);
  }

  private get facialEventCodes(): string {
    return (
      this.configService.get('FACIAL_EVENT_CODES', { infer: true })?.trim() ||
      'All'
    );
  }

  private get streamVerbose(): boolean {
    return (
      this.configService.get('FACIAL_STREAM_VERBOSE', { infer: true }) === '1'
    );
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
    for (const timer of this.lastSeenDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.lastSeenDebounceTimers.clear();
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
        d.brand === 'intelbras' && d.hasCredentials && d.isActive;

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
            : d.brand !== 'intelbras'
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
        'Nenhum leitor Intelbras ativo com credenciais — streams não iniciados',
      );
      return;
    }

    this.logger.log(
      `Iniciando stream eventManager em ${valid.length} leitor(es) Intelbras...`,
    );

    for (const ctx of valid) {
      this.statuses.set(ctx.id, {
        readerId: ctx.id,
        readerName: ctx.name,
        clientName: ctx.clientName,
        brand: toBrandSlug(ctx.brand),
        host: ctx.host,
        connected: false,
        eventsReceived: 0,
      });
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
        this.teardownReader(
          id,
          'removido ou sem credenciais / inativo / não Intelbras',
        );
      }
    }

    for (const ctx of validContexts) {
      const dbHost = ctx.host;
      const existing = this.statuses.get(ctx.id);

      if (!existing) {
        this.statuses.set(ctx.id, {
          readerId: ctx.id,
          readerName: ctx.name,
          clientName: ctx.clientName,
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
        this.abortReaderStream(ctx.id);
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

  private abortReaderStream(readerId: string): void {
    const ac = this.streamAbortByReader.get(readerId);
    if (ac) {
      ac.abort();
      this.streamAbortByReader.delete(readerId);
    }
  }

  private teardownReader(readerId: string, reason: string): void {
    this.logger.log(`[FaceListener] Encerrando stream ${readerId}: ${reason}`);
    this.clearReconnectTimer(readerId);
    this.bumpConnectGeneration(readerId);
    this.abortReaderStream(readerId);
    this.buffers.delete(readerId);
    this.partBuffers.delete(readerId);
    const t = this.lastSeenDebounceTimers.get(readerId);
    if (t) clearTimeout(t);
    this.lastSeenDebounceTimers.delete(readerId);
    this.statuses.delete(readerId);
  }

  private async subscribeReaderFromDb(readerId: string): Promise<void> {
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
        clientName: row.clientName,
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
    this.subscribe(ctx);
  }

  private buildUrl(host: string): string {
    const codes = this.facialEventCodes;
    return (
      `http://${host}/cgi-bin/eventManager.cgi` +
      `?action=attach&codes=[${codes}]&heartbeat=5`
    );
  }

  private subscribe(ctx: ReaderStreamContext): void {
    const gen = this.bumpConnectGeneration(ctx.id);
    this.abortReaderStream(ctx.id);

    const ac = new AbortController();
    this.streamAbortByReader.set(ctx.id, ac);

    const url = this.buildUrl(ctx.host);
    const auth = new AxiosDigestAuth({
      username: ctx.username,
      password: ctx.passwordPlain,
    });

    this.updateStatus(ctx.id, {
      readerName: ctx.name,
      host: ctx.host,
      clientName: ctx.clientName,
    });

    this.logger.log(`[FaceListener] Conectando "${ctx.name}" → ${url}`);

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
          `[FaceListener] Conectado "${ctx.name}" — aguardando eventos`,
        );

        this.buffers.set(ctx.id, '');
        this.partBuffers.set(ctx.id, []);
        this.updateStatus(ctx.id, {
          connected: true,
          connectedSince: new Date(),
          lastConnectionError: undefined,
        });

        const stream = response.data as Readable;

        stream.on('data', (chunk: Buffer) => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.processChunk(chunk.toString(), ctx);
        });

        stream.on('end', () => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.logger.warn(
            `[FaceListener] Stream encerrada: "${ctx.name}". Reconectando em 5s...`,
          );
          this.updateStatus(ctx.id, {
            connected: false,
            lastConnectionError: 'Stream encerrada pelo leitor',
          });
          this.scheduleReconnect(ctx.id, 5_000);
        });

        stream.on('error', (err: Error) => {
          if (this.connectGeneration.get(ctx.id) !== gen) return;
          this.logger.error(
            `[FaceListener] Erro na stream "${ctx.name}": ${err.message}`,
          );
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
        this.logger.error(
          `[FaceListener] Falha ao conectar "${ctx.name}": ${err.message}`,
        );
        this.updateStatus(ctx.id, {
          connected: false,
          lastConnectionError: err.message,
        });
        this.scheduleReconnect(ctx.id, 10_000);
      });
  }

  private processChunk(chunk: string, ctx: ReaderStreamContext): void {
    const buffered = (this.buffers.get(ctx.id) ?? '') + chunk;
    const lines = buffered.split('\n');

    this.buffers.set(ctx.id, lines.pop() ?? '');

    const partBuffer = this.partBuffers.get(ctx.id) ?? [];
    this.partBuffers.set(ctx.id, partBuffer);

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === 'Heartbeat') {
        continue;
      }

      if (
        trimmed === '--myboundary' ||
        trimmed === '--myboundary--' ||
        trimmed.startsWith('--myboundary')
      ) {
        this.processPartBuffer(partBuffer, ctx);
        partBuffer.length = 0;
        continue;
      }

      if (trimmed.length > 0) {
        partBuffer.push(trimmed);
      }
    }
  }

  private processPartBuffer(
    partLines: string[],
    ctx: ReaderStreamContext,
  ): void {
    if (partLines.length === 0) {
      return;
    }

    const payloadLines: string[] = [];
    let inPayload = false;

    for (const line of partLines) {
      if (
        line.startsWith('Content-Type:') ||
        line.startsWith('Content-Length:')
      ) {
        continue;
      } else if (line.startsWith('Code=')) {
        inPayload = true;
        payloadLines.push(line);
      } else if (inPayload) {
        payloadLines.push(line);
      }
    }

    if (payloadLines.length === 0) {
      return;
    }

    const rawPayloadText = payloadLines.join('\n');

    const event =
      payloadLines.length === 1
        ? parseVideoEventLine(payloadLines[0])
        : parseVideoEventPayload(payloadLines);

    if (!event) {
      if (this.streamVerbose) {
        this.logger.warn(
          `[FaceListener] Parse falhou "${ctx.name}" raw=${rawPayloadText.slice(0, 500)}`,
        );
      } else {
        this.logger.warn(
          `[FaceListener] Parse falhou (eventManager): "${ctx.name}" (readerId=${ctx.id})`,
        );
      }
      return;
    }

    this.updateStatus(ctx.id, {
      eventsReceived: (this.statuses.get(ctx.id)?.eventsReceived ?? 0) + 1,
      lastEventAt: new Date(),
    });

    this.scheduleLastSeenPersist(ctx.id);

    if (this.streamVerbose) {
      this.logger.log(
        `[FaceListener] ${ctx.name} | ${event.code} | ${event.action} | index=${event.index}`,
      );
      this.logger.log(
        `[FaceListener] raw len=${rawPayloadText.length} preview=${rawPayloadText.slice(0, 400)}`,
      );
    }

    void this.accessesService
      .recordDoorFacePulseIfApplicable(event, ctx)
      .catch((err: unknown) => {
        this.logger.warn(
          `[FaceListener] Persistência de acesso falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private scheduleReconnect(readerId: string, delayMs: number): void {
    this.clearReconnectTimer(readerId);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(readerId);
      void this.subscribeReaderFromDb(readerId);
    }, delayMs);
    this.reconnectTimers.set(readerId, timer);
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
    if (current) {
      this.statuses.set(readerId, { ...current, ...partial });
    }
  }
}
