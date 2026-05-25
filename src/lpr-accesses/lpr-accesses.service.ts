import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';

import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import { clients } from '../database/schema';
import type { VideoEvent } from '../face-listener/video-stream.parser';
import type { CameraStreamContext } from '../lpr-listener/lpr-listener.types';
import type { LprStreamReadingPayload } from '../lpr-listener/lpr-stream.parser';
import { ACCESS_LPR_RECORDED } from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';
import { LprAccess, type LprAccessDocument } from './lpr-access.schema';

export type LprAccessListItemDto = {
  id: string;
  companyId: string;
  cameraId: string;
  cameraName: string;
  clientId: string;
  clientName: string;
  plateNumber: string;
  plateColor: string | null;
  confidence: number | null;
  vehicleType: string | null;
  vehicleBrand: string | null;
  direction: string | null;
  snapTime: string | null;
  isAllowed: boolean | null;
  isBlocked: boolean | null;
  cutoutPicKey: string | null;
  createdAt: string;
};

export type LprAccessListResponse = {
  items: LprAccessListItemDto[];
  page: number;
  pageSize: number;
  total: number;
};

/** Metadados opcionais de origem ao persistir — usado quando `LPR_DEBUG_RAW=1`. */
export type LprRecordIngressMeta = {
  stream: 'eventManager' | 'snapManager';
  /** eventManager — evento já parseado (inclui `data` JSON e `raw` da linha). */
  videoEvent?:
    | Pick<VideoEvent, 'code' | 'action' | 'index' | 'data' | 'raw'>
    | null;
};

function parseDeviceDate(raw: string | null | undefined): Date | null {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).trim();
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Converte confiança ANPR para percentual inteiro (0–100) para exibição. */
function normalizeConfidencePercent(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 0 && value <= 1) return Math.round(value * 100);
  return Math.round(value);
}

@Injectable()
export class LprAccessesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LprAccessesService.name);
  private readonly processedKeys = new Map<string, number>();
  private readonly DEDUP_TTL_MS = 5 * 60 * 1000;
  private dedupCleanupTimer?: ReturnType<typeof setInterval>;

  private static readonly DEFAULT_PAGE_SIZE = 20;

  constructor(
    @InjectModel(LprAccess.name)
    private readonly lprModel: Model<LprAccessDocument>,
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
    private readonly eventEmitter: EventEmitter2,
    private readonly r2Storage: R2StorageService,
  ) {}

  onModuleInit(): void {
    this.dedupCleanupTimer = setInterval(() => {
      this.cleanupExpiredDedupKeys();
    }, this.DEDUP_TTL_MS);
  }

  onModuleDestroy(): void {
    if (this.dedupCleanupTimer) {
      clearInterval(this.dedupCleanupTimer);
    }
  }

  private cleanupExpiredDedupKeys(): void {
    const cutoff = Date.now() - this.DEDUP_TTL_MS;
    for (const [key, ts] of this.processedKeys) {
      if (ts < cutoff) this.processedKeys.delete(key);
    }
  }

  private dedupKey(
    ctx: CameraStreamContext,
    reading: LprStreamReadingPayload,
    normalizedPlate: string,
  ): string {
    const t = reading.accurateTimeRaw ?? reading.snapTimeRaw ?? '';
    const ch = reading.channel ?? '';
    const code = reading.eventCode ?? '';
    return `${ctx.id}|${normalizedPlate}|${t}|${ch}|${code}`;
  }

  private isLprRawDebugEnabled(): boolean {
    const v = this.configService.get('LPR_DEBUG_RAW', { infer: true });
    if (v == null || v.trim() === '') return false;
    const s = v.trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
  }

  private consoleLprRawPayload(payload: Record<string, unknown>): void {
    console.log(`[Face2GO][LPR][RAW]\n${JSON.stringify(payload, null, 2)}`);
  }

  /** Persiste leitura ANPR dos streams CGI (JPEGs opcionais no R2). */
  async recordLprReading(
    reading: LprStreamReadingPayload,
    ctx: CameraStreamContext,
    imageJpegs?: Buffer[],
    ingress?: LprRecordIngressMeta,
  ): Promise<void> {
    let plateNum = reading.plateNumber?.trim();
    if (
      plateNum == null ||
      plateNum === '' ||
      plateNum === '(sem placa reconhecida)'
    ) {
      return;
    }

    plateNum = plateNum.toUpperCase();

    const dk = this.dedupKey(ctx, reading, plateNum);
    if (this.isLprRawDebugEnabled()) {
      this.consoleLprRawPayload({
        phase: 'ingress',
        dedupKey: dk,
        stream:
          ingress?.stream ??
          '(meta ausente — ative atualização no lpr-listener)',
        cameraId: ctx.id,
        cameraName: ctx.name,
        normalizedPlate: plateNum,
        normalizedReading: reading,
        videoEventRaw: ingress?.videoEvent ?? null,
        jpegCount: imageJpegs?.length ?? 0,
        receivedAt: new Date().toISOString(),
      });
    }
    if (this.processedKeys.has(dk)) {
      if (this.isLprRawDebugEnabled()) {
        this.consoleLprRawPayload({
          phase: 'skip_duplicate_dedup',
          dedupKey: dk,
          stream:
            ingress?.stream ??
            '(meta ausente — ative atualização no lpr-listener)',
          cameraId: ctx.id,
          normalizedPlate: plateNum,
        });
      }
      return;
    }
    this.processedKeys.set(dk, Date.now());

    const snapTime = parseDeviceDate(reading.snapTimeRaw);
    const accurateTime = parseDeviceDate(reading.accurateTimeRaw);

    let cutoutPicKey: string | null = null;
    let vehiclePicKey: string | null = null;
    let normalPicKey: string | null = null;

    const imgs = imageJpegs?.filter((b) => b && b.length > 0) ?? [];
    const prefix = `lpr-accesses/${ctx.companyId}/${ctx.id}`;
    const put = async (buf: Buffer, slot: string) => {
      const key = `${prefix}/${Date.now()}-${slot}-${randomBytes(4).toString('hex')}.jpg`;
      try {
        await this.r2Storage.putObject(key, buf, 'image/jpeg');
        return key;
      } catch (err: unknown) {
        this.logger.warn(
          `[LprAccesses] Upload R2 falhou (${slot}): ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    };

    if (imgs.length === 1) {
      cutoutPicKey = (await put(imgs[0]!, 'cutout')) ?? null;
    } else if (imgs.length === 2) {
      cutoutPicKey = (await put(imgs[0]!, 'cutout')) ?? null;
      vehiclePicKey = (await put(imgs[1]!, 'vehicle')) ?? null;
    } else if (imgs.length >= 3) {
      cutoutPicKey = (await put(imgs[0]!, 'cutout')) ?? null;
      vehiclePicKey = (await put(imgs[1]!, 'vehicle')) ?? null;
      normalPicKey = (await put(imgs[2]!, 'normal')) ?? null;
    }

    const rawPayload: Record<string, unknown> = {
      ...reading,
      plateNumber: plateNum,
      sourceHost: ctx.host,
    };

    try {
      const doc = await this.lprModel.create({
        companyId: ctx.companyId,
        cameraId: ctx.id,
        cameraName: ctx.name,
        clientId: ctx.clientId,
        clientName: ctx.clientName,
        deviceIdReported: reading.deviceIdReported ?? null,
        plateNumber: plateNum,
        plateColor: reading.plateColor ?? null,
        plateType: reading.plateType ?? null,
        confidence: reading.confidence ?? null,
        vehicleColor: reading.vehicleColor ?? null,
        vehicleType: reading.vehicleType ?? null,
        vehicleBrand: reading.vehicleBrand ?? null,
        speed: reading.speed ?? null,
        direction: reading.direction ?? null,
        laneNo: reading.laneNo ?? null,
        channel: reading.channel ?? null,
        snapTime,
        accurateTime,
        isAllowed: reading.isAllowed ?? null,
        isBlocked: reading.isBlocked ?? null,
        openStrobe: reading.openStrobe ?? null,
        cutoutPicKey,
        vehiclePicKey,
        normalPicKey,
        rawPayload,
      });

      this.eventEmitter.emit(ACCESS_LPR_RECORDED, {
        accessId: String(doc._id),
        cameraId: ctx.id,
        clientId: ctx.clientId,
        plateNumber: plateNum,
        cameraName: ctx.name,
        snapTime,
      });

      if (this.isLprRawDebugEnabled()) {
        const cre = doc as { createdAt?: Date };
        this.consoleLprRawPayload({
          phase: 'persisted_mongo',
          accessId: String(doc._id),
          dedupKey: dk,
          stream:
            ingress?.stream ??
            '(meta ausente — ative atualização no lpr-listener)',
          cameraId: ctx.id,
          normalizedPlate: plateNum,
          mongoCreatedAt:
            cre.createdAt instanceof Date
              ? cre.createdAt.toISOString()
              : null,
        });
      }
    } catch (err: unknown) {
      this.logger.error(
        `Mongo create lpr_access falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  async listForCompany(
    companyId: string,
    options: {
      clientId?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
    },
  ): Promise<LprAccessListResponse> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = LprAccessesService.DEFAULT_PAGE_SIZE;

    if (options.clientId) {
      const row = await this.database.db.query.clients.findFirst({
        where: and(
          eq(clients.id, options.clientId),
          eq(clients.companyId, companyId),
        ),
      });
      if (!row) {
        return { items: [], page, pageSize, total: 0 };
      }
    }

    const filter: Record<string, unknown> = { companyId };
    if (options.clientId) {
      filter.clientId = options.clientId;
    }

    let start: Date | undefined;
    let end: Date | undefined;
    if (options.startDate) {
      start = new Date(options.startDate);
      if (Number.isNaN(start.getTime())) {
        start = undefined;
      }
    }
    if (options.endDate) {
      end = new Date(options.endDate);
      if (Number.isNaN(end.getTime())) {
        end = undefined;
      } else {
        end.setHours(23, 59, 59, 999);
      }
    }
    if (start && end) {
      filter.createdAt = { $gte: start, $lte: end };
    } else if (start) {
      filter.createdAt = { $gte: start };
    } else if (end) {
      filter.createdAt = { $lte: end };
    }

    const total = await this.lprModel.countDocuments(filter).exec();
    const skip = (page - 1) * pageSize;

    const docs = await this.lprModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean()
      .exec();

    const items: LprAccessListItemDto[] = docs.map((doc) => {
      const d = doc as LprAccessDocument & {
        _id: { toString(): string };
        createdAt?: Date;
        snapTime?: Date | null;
      };
      return {
        id: d._id.toString(),
        companyId: d.companyId,
        cameraId: d.cameraId,
        cameraName: d.cameraName,
        clientId: d.clientId,
        clientName: d.clientName,
        plateNumber: d.plateNumber,
        plateColor: d.plateColor ?? null,
        confidence: normalizeConfidencePercent(d.confidence ?? null),
        vehicleType: d.vehicleType ?? null,
        vehicleBrand: d.vehicleBrand ?? null,
        direction: d.direction ?? null,
        snapTime: d.snapTime ? d.snapTime.toISOString() : null,
        isAllowed: d.isAllowed ?? null,
        isBlocked: d.isBlocked ?? null,
        cutoutPicKey: d.cutoutPicKey ?? null,
        createdAt: d.createdAt
          ? d.createdAt.toISOString()
          : new Date().toISOString(),
      };
    });

    return { items, page, pageSize, total };
  }
}
