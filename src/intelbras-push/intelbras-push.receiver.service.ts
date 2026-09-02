import { Injectable, Logger } from '@nestjs/common';

import type { ReaderStreamContextLike } from '../accesses/reader-stream-context.type';
import { AccessesService } from '../accesses/accesses.service';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import { FaceListenerService } from '../face-listener/face-listener.service';
import type { VideoEvent } from '../face-listener/face-listener.types';
import {
  parseIntelbrasPushBody,
  type IntelbrasPushEvent,
  type IntelbrasPushIdentity,
} from './intelbras-push.parser';

const UNKNOWN_LOG_WINDOW_MS = 60_000;

@Injectable()
export class IntelbrasPushReceiverService {
  private readonly logger = new Logger(IntelbrasPushReceiverService.name);
  private readonly unknownLogAt = new Map<string, number>();

  constructor(
    private readonly database: DatabaseService,
    private readonly accessesService: AccessesService,
    private readonly faceListener: FaceListenerService,
  ) {}

  async handlePush(params: {
    contentType?: string;
    raw: Buffer;
    readerId?: string;
    clientIp?: string;
  }): Promise<void> {
    let parsed: ReturnType<typeof parseIntelbrasPushBody>;
    try {
      parsed = parseIntelbrasPushBody(params.contentType, params.raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logUnknown(
        params.readerId ? '/device-events parse' : '/notification parse',
        {
          readerId: params.readerId,
          clientIp: params.clientIp,
          bytes: params.raw.length,
          extra: message,
        },
      );
      return;
    }

    if (parsed.events.length === 0) {
      if (!params.readerId) {
        this.logUnknown('legado sem evento rastreável', {
          readerId: params.readerId,
          identity: parsed.identity,
          format: parsed.format,
          clientIp: params.clientIp,
          bytes: params.raw.length,
        });
      } else {
        this.logger.debug(
          `[IntelbrasPush] ${parsed.format} sem evento rastreável (readerId=${params.readerId})`,
        );
      }
      return;
    }

    for (const event of parsed.events) {
      const identity: IntelbrasPushIdentity = {
        serial: event.serial ?? parsed.identity.serial,
        mac: event.mac ?? parsed.identity.mac,
        codes: parsed.identity.codes.length
          ? parsed.identity.codes
          : [event.code],
        channel: parsed.identity.channel,
      };
      const row = await this.resolveReader({
        readerId: params.readerId,
        serial: identity.serial,
      });
      if (!row) {
        this.logUnknown(
          params.readerId ? 'uuid sem leitor' : 'legado sem leitor',
          {
            readerId: params.readerId,
            identity,
            format: parsed.format,
            clientIp: params.clientIp,
            bytes: params.raw.length,
          },
        );
        continue;
      }

      if (params.readerId && event.serial) {
        await this.learnSerial(row, event.serial);
      }

      this.faceListener.notePushActivity(row.id);

      if (event.code === 'DoorStatus') {
        this.logger.log(
          `[IntelbrasPush] ${row.name} DoorStatus Status=${event.data.Status ?? '—'}`,
        );
        continue;
      }

      if (!row.isActive) {
        continue;
      }

      this.logger.log(
        `[IntelbrasPush] ${row.name} UserID=${event.data.UserID ?? '—'} Status=${event.data.Status ?? '—'}`,
      );
      await this.persistAccess(row, event, parsed.jpeg);
    }
  }

  private async persistAccess(
    row: readersQueries.ReaderPushRow,
    event: IntelbrasPushEvent,
    jpeg: Buffer | null,
  ): Promise<void> {
    const videoEvent: VideoEvent = {
      code: event.code,
      action: event.action ?? 'Pulse',
      index: 0,
      data: { ...event.data },
    };
    const ctx: ReaderStreamContextLike = {
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      clientName: row.clientName,
      companyId: row.companyId,
      host: `${row.ip.trim()}:${row.port}`,
      direction: row.direction,
    };
    await this.accessesService.recordSnapManagerAccess(videoEvent, ctx, jpeg);
  }

  private async resolveReader(params: {
    readerId?: string;
    serial?: string;
  }): Promise<readersQueries.ReaderPushRow | undefined> {
    if (params.readerId) {
      return readersQueries.getReaderForPushById(
        this.database.db,
        params.readerId,
      );
    }
    const serial = params.serial?.trim();
    if (!serial) {
      return undefined;
    }
    return readersQueries.findReaderForPushBySerial(this.database.db, serial);
  }

  private async learnSerial(
    row: readersQueries.ReaderPushRow,
    serial: string,
  ): Promise<void> {
    if (row.serialNumber?.trim()) {
      return;
    }
    await readersQueries.setReaderSerialIfEmpty(
      this.database.db,
      row.id,
      serial,
    );
    row.serialNumber = serial;
    this.logger.log(`[IntelbrasPush] serial gravado em "${row.name}"`);
  }

  private logUnknown(
    reason: string,
    params: {
      readerId?: string;
      identity?: IntelbrasPushIdentity;
      format?: string;
      clientIp?: string;
      bytes?: number;
      extra?: string;
    },
  ): void {
    const mac = params.identity?.mac ?? '—';
    const sn = params.identity?.serial ?? '—';
    const ip = params.clientIp ?? '—';
    const fingerprint = `${mac}|${sn}|${ip}|${reason}`;
    if (!this.shouldLogUnknown(fingerprint)) {
      return;
    }
    const codes = params.identity?.codes.length
      ? params.identity.codes.join(',')
      : '—';
    const extra = params.extra ? ` err=${params.extra}` : '';
    this.logger.warn(
      `[IntelbrasPush] ${reason} ` +
        `readerId=${params.readerId ?? '—'} ` +
        `mac=${mac} sn=${sn} ip=${ip} ` +
        `codes=${codes} ` +
        `ch=${params.identity?.channel ?? '—'} ` +
        `bytes=${params.bytes ?? '—'} ` +
        `fmt=${params.format ?? '—'} ` +
        extra,
    );
  }

  private shouldLogUnknown(key: string): boolean {
    const now = Date.now();
    const prev = this.unknownLogAt.get(key);
    if (prev != null && now - prev < UNKNOWN_LOG_WINDOW_MS) {
      return false;
    }
    this.unknownLogAt.set(key, now);
    if (this.unknownLogAt.size > 300) {
      this.unknownLogAt.clear();
      this.unknownLogAt.set(key, now);
    }
    return true;
  }
}
